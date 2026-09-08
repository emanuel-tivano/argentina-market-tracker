import 'server-only'

import type { MarketDataPanelKey } from '@/lib/market'
import {
  normalizePanelData,
  normalizePanelDataResult,
  PanelNormalizationError,
  type PanelSuccessResponse,
  type PanelTitulo,
} from '@/lib/panel'
import { getDemoPanelData } from '@/lib/server/demo/demoMarketData'
import { ENV } from '@/lib/server/core/env'
import {
  iolFetch,
  isRecoverableIolUpstreamError,
} from '@/lib/server/upstream/iol'
import { incrementMetricCounter, logServerWarn } from '@/lib/server/core/observability'
import { getPanelEndpoint } from '@/lib/server/panel/panelEndpoint'

type PanelCacheEntry = {
  data: PanelTitulo[]
  fetchedAt: string
  freshUntil: number
  staleUntil: number
}

const panelCache = new Map<MarketDataPanelKey, PanelCacheEntry>()
type InFlightPanelRequest = {
  initiatedBy: 'normal' | 'refresh'
  promise: Promise<PanelSuccessResponse>
}

const inFlightPanelRequests = new Map<
  MarketDataPanelKey,
  InFlightPanelRequest
>()

function getFixturePanelResponse(
  type: MarketDataPanelKey
): PanelSuccessResponse | null {
  const fixture = process.env.PANEL_RESPONSE_FIXTURE_JSON

  if (!fixture) {
    return null
  }

  const fixtureAllowed =
    ENV.NODE_ENV === 'test' || process.env.PLAYWRIGHT_E2E_MODE === 'ssr'

  if (!fixtureAllowed) {
    throw new Error(
      'PANEL_RESPONSE_FIXTURE_JSON is allowed only in test or explicit SSR E2E mode'
    )
  }

  let parsedFixture: unknown

  try {
    parsedFixture = JSON.parse(fixture)
  } catch {
    throw new Error('Invalid PANEL_RESPONSE_FIXTURE_JSON')
  }

  if (
    !parsedFixture ||
    typeof parsedFixture !== 'object' ||
    Array.isArray(parsedFixture)
  ) {
    throw new Error('Invalid PANEL_RESPONSE_FIXTURE_JSON')
  }

  const typedFixture = parsedFixture as Partial<Record<MarketDataPanelKey, unknown>>
  const data = normalizePanelData(typedFixture[type] ?? [])
  const now = Date.now()
  const fetchedAt = new Date(now).toISOString()
  incrementMetricCounter('panel.cache.event.total', 1, {
    event: 'fixture-hit',
    panelType: type,
  })

  return createPanelResponse(
    data,
    fetchedAt,
    'fresh',
    false,
    now,
    now + ENV.PANEL_CACHE_STALE_TTL_MS
  )
}

function createPanelResponse(
  data: PanelCacheEntry['data'],
  fetchedAt: string,
  cacheStatus: PanelSuccessResponse['cacheStatus'],
  stale: boolean,
  servedAt: number,
  staleUntil: number,
  degradationReason?: PanelSuccessResponse['degradationReason']
): PanelSuccessResponse {
  return {
    ok: true,
    data,
    fetchedAt,
    servedAt: new Date(servedAt).toISOString(),
    staleUntil: new Date(staleUntil).toISOString(),
    cacheStatus,
    stale,
    ...(degradationReason ? { degradationReason } : {}),
  }
}

function getCachedPanelResponse(
  type: MarketDataPanelKey
): PanelSuccessResponse | null {
  const now = Date.now()
  const cached = panelCache.get(type)

  if (!cached) {
    incrementMetricCounter('panel.cache.event.total', 1, {
      event: 'miss',
      panelType: type,
    })
    return null
  }

  if (now >= cached.staleUntil) {
    panelCache.delete(type)
    incrementMetricCounter('panel.cache.event.total', 1, {
      event: 'stale-expired',
      panelType: type,
    })
    return null
  }

  if (now >= cached.freshUntil) {
    incrementMetricCounter('panel.cache.event.total', 1, {
      event: 'fresh-expired',
      panelType: type,
    })
    return null
  }

  incrementMetricCounter('panel.cache.event.total', 1, {
    event: 'hit',
    panelType: type,
  })

  return createPanelResponse(
    cached.data,
    cached.fetchedAt,
    'memory-cache',
    false,
    now,
    cached.staleUntil
  )
}

function canUseStalePanelFallback(error: unknown): boolean {
  return (
    error instanceof PanelNormalizationError ||
    isRecoverableIolUpstreamError(error)
  )
}

function getStalePanelResponse(
  type: MarketDataPanelKey,
  error: unknown
): PanelSuccessResponse | null {
  if (!canUseStalePanelFallback(error)) {
    return null
  }

  const now = Date.now()
  const cached = panelCache.get(type)

  if (!cached || now >= cached.staleUntil) {
    if (cached) {
      panelCache.delete(type)
    }
    return null
  }

  const stale = now >= cached.freshUntil

  logServerWarn(
    stale ? 'panel.cache.stale-fallback' : 'panel.cache.fresh-fallback',
    {
      panelType: type,
      reason: error instanceof Error ? error.message : String(error ?? 'unknown'),
    }
  )
  incrementMetricCounter('panel.cache.event.total', 1, {
    event: now < cached.freshUntil ? 'fresh-fallback' : 'stale-fallback',
    panelType: type,
    source: ENV.MARKET_DATA_SOURCE,
  })

  return createPanelResponse(
    cached.data,
    cached.fetchedAt,
    stale ? 'stale' : 'memory-cache',
    stale,
    now,
    cached.staleUntil,
    stale ? 'upstream-unavailable' : undefined
  )
}

function setCachedPanelResponse(
  type: MarketDataPanelKey,
  data: PanelTitulo[],
  now: number
): PanelSuccessResponse {
  const fetchedAt = new Date(now).toISOString()
  const freshUntil = now + ENV.PANEL_CACHE_FRESH_TTL_MS
  const staleUntil = now + ENV.PANEL_CACHE_STALE_TTL_MS

  panelCache.set(type, {
    data,
    fetchedAt,
    freshUntil,
    staleUntil,
  })
  incrementMetricCounter('panel.cache.event.total', 1, {
    event: 'write',
    panelType: type,
    source: ENV.MARKET_DATA_SOURCE,
  })

  return createPanelResponse(
    data,
    fetchedAt,
    'fresh',
    false,
    now,
    staleUntil
  )
}

async function fetchPanelResponse(
  type: MarketDataPanelKey
): Promise<PanelSuccessResponse> {
  const data =
    ENV.MARKET_DATA_SOURCE === 'demo'
      ? getDemoPanelData(type)
      : await iolFetch(getPanelEndpoint(type))
  const normalized = normalizePanelDataResult(data)

  if (normalized.droppedItemsCount > 0) {
    logServerWarn('panel.normalize.partial', {
      panelType: type,
      droppedItemsCount: normalized.droppedItemsCount,
      droppedItemsSummary: normalized.droppedItemsSummary.map(
        (issue) => issue.reason
      ),
    })
  }

  const now = Date.now()
  return setCachedPanelResponse(type, normalized.data, now)
}

function getOrCreateUpstreamPanelResponse(
  type: MarketDataPanelKey,
  initiatedBy: InFlightPanelRequest['initiatedBy']
): Promise<PanelSuccessResponse> {
  const inFlight = inFlightPanelRequests.get(type)

  if (inFlight) {
    incrementMetricCounter('panel.cache.event.total', 1, {
      event: 'inflight-hit',
      panelType: type,
      initiatedBy: inFlight.initiatedBy,
    })
    return inFlight.promise
  }

  const promise = fetchPanelResponse(type)
    .catch((error: unknown) => {
      const stale = getStalePanelResponse(type, error)

      if (stale) {
        return stale
      }

      throw error
    })
    .finally(() => {
      if (inFlightPanelRequests.get(type)?.promise === promise) {
        inFlightPanelRequests.delete(type)
      }
    })

  inFlightPanelRequests.set(type, { initiatedBy, promise })
  return promise
}

export function getOrCreatePanelResponse(
  type: MarketDataPanelKey,
  bypassCache: boolean
): Promise<PanelSuccessResponse> {
  const fixtureResponse = getFixturePanelResponse(type)

  if (fixtureResponse) {
    return Promise.resolve(fixtureResponse)
  }

  if (bypassCache) {
    incrementMetricCounter('panel.cache.event.total', 1, {
      event: 'refresh-bypass',
      panelType: type,
    })
    return getOrCreateUpstreamPanelResponse(type, 'refresh')
  }

  // A normal read joins a pending refresh before consulting the cache so both
  // consumers observe the same current upstream result.
  const inFlight = inFlightPanelRequests.get(type)

  if (inFlight) {
    return inFlight.promise
  }

  const cached = getCachedPanelResponse(type)

  if (cached) {
    return Promise.resolve(cached)
  }

  return getOrCreateUpstreamPanelResponse(type, 'normal')
}

export function hasInFlightPanelRefresh(type: MarketDataPanelKey): boolean {
  return inFlightPanelRequests.get(type)?.initiatedBy === 'refresh'
}

export function clearPanelResponseCacheForTests() {
  panelCache.clear()
  inFlightPanelRequests.clear()
}

export function getPanelCacheStats() {
  return {
    entries: panelCache.size,
    inFlight: inFlightPanelRequests.size,
    inFlightRefresh: [...inFlightPanelRequests.values()].filter(
      (request) => request.initiatedBy === 'refresh'
    ).length,
    ttlMs: ENV.PANEL_CACHE_FRESH_TTL_MS,
    freshTtlMs: ENV.PANEL_CACHE_FRESH_TTL_MS,
    staleTtlMs: ENV.PANEL_CACHE_STALE_TTL_MS,
  }
}
