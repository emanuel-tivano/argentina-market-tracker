import 'server-only'

import {
  type StockHistoryMarket,
  type StockHistoryRange,
  type StockHistoryResponse,
  type StockHistorySuccessResponse,
} from '@/lib/stockHistory'
import { incrementMetricCounter } from '@/lib/server/core/observability'

const HISTORY_CACHE_TTL_MS = 5 * 60_000
const HISTORY_CACHE_STALE_TTL_MS = 30 * 60_000
const HISTORY_CACHE_MAX_KEYS = 500

type HistoryCacheEntry = {
  fetchedAt: string
  response: StockHistorySuccessResponse
  freshUntil: number
  staleUntil: number
}

const historyCache = new Map<string, HistoryCacheEntry>()
const inFlightHistoryRequests = new Map<string, Promise<StockHistoryResponse>>()

function getCacheKey(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange
): string {
  return `${market}:${symbol}:${range}`
}

function pruneHistoryCache(now = Date.now()) {
  for (const [key, entry] of historyCache) {
    if (now >= entry.staleUntil) {
      historyCache.delete(key)
    }
  }

  if (historyCache.size <= HISTORY_CACHE_MAX_KEYS) {
    return
  }

  const entriesByOldestExpiry = [...historyCache.entries()].sort(
    ([, first], [, second]) => first.staleUntil - second.staleUntil
  )

  for (const [key] of entriesByOldestExpiry.slice(
    0,
    historyCache.size - HISTORY_CACHE_MAX_KEYS
  )) {
    historyCache.delete(key)
  }
}

function buildCachedHistoryResponse(
  entry: HistoryCacheEntry,
  cacheStatus: StockHistorySuccessResponse['cacheStatus']
): StockHistorySuccessResponse {
  return {
    ...entry.response,
    servedAt: new Date().toISOString(),
    cacheStatus,
    meta: {
      ...entry.response.meta,
      stale: cacheStatus === 'stale',
    },
  }
}

export function getCachedHistoryResponse(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange
): StockHistorySuccessResponse | null {
  pruneHistoryCache()

  const cacheKey = getCacheKey(symbol, market, range)
  const cached = historyCache.get(cacheKey)

  if (!cached || Date.now() >= cached.staleUntil) {
    historyCache.delete(cacheKey)
    incrementMetricCounter('history.cache.event.total', 1, {
      event: 'miss',
      market,
      range,
    })
    return null
  }

  if (Date.now() >= cached.freshUntil) {
    incrementMetricCounter('history.cache.event.total', 1, {
      event: 'stale-window-miss',
      market,
      range,
    })
    return null
  }

  incrementMetricCounter('history.cache.event.total', 1, {
    event: 'hit',
    market,
    range,
  })

  return buildCachedHistoryResponse(cached, 'memory-cache')
}

export function getStaleHistoryResponse(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange
): StockHistorySuccessResponse | null {
  pruneHistoryCache()

  const cacheKey = getCacheKey(symbol, market, range)
  const cached = historyCache.get(cacheKey)

  if (!cached || Date.now() >= cached.staleUntil) {
    historyCache.delete(cacheKey)
    incrementMetricCounter('history.cache.event.total', 1, {
      event: 'stale-miss',
      market,
      range,
    })
    return null
  }

  incrementMetricCounter('history.cache.event.total', 1, {
    event: 'stale-hit',
    market,
    range,
  })

  return buildCachedHistoryResponse(cached, 'stale')
}

export function setCachedHistoryResponse(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange,
  response: StockHistoryResponse
) {
  if (!response.ok) {
    return
  }

  historyCache.set(getCacheKey(symbol, market, range), {
    response,
    fetchedAt: response.fetchedAt,
    freshUntil: Date.now() + HISTORY_CACHE_TTL_MS,
    staleUntil: Date.now() + HISTORY_CACHE_STALE_TTL_MS,
  })
  pruneHistoryCache()
  incrementMetricCounter('history.cache.event.total', 1, {
    event: 'write',
    market,
    range,
    source: response.meta.source,
  })
}

export function getOrCreateInFlightHistoryRequest(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange,
  factory: () => Promise<StockHistorySuccessResponse>
): Promise<StockHistorySuccessResponse>
export function getOrCreateInFlightHistoryRequest(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange,
  factory: () => Promise<StockHistoryResponse>
) {
  const cacheKey = getCacheKey(symbol, market, range)
  const inFlight = inFlightHistoryRequests.get(cacheKey)

  if (inFlight) {
    incrementMetricCounter('history.cache.event.total', 1, {
      event: 'inflight-hit',
      market,
      range,
    })
    return inFlight
  }

  const promise = factory().finally(() => {
    if (inFlightHistoryRequests.get(cacheKey) === promise) {
      inFlightHistoryRequests.delete(cacheKey)
    }
  })

  inFlightHistoryRequests.set(cacheKey, promise)
  return promise
}

export function getHistoryCacheSizeForTests() {
  pruneHistoryCache()
  return historyCache.size
}

export function getHistoryCacheStats() {
  pruneHistoryCache()

  return {
    entries: historyCache.size,
    freshTtlMs: HISTORY_CACHE_TTL_MS,
    inFlight: inFlightHistoryRequests.size,
    maxKeys: HISTORY_CACHE_MAX_KEYS,
    staleTtlMs: HISTORY_CACHE_STALE_TTL_MS,
  }
}

export function clearHistoryCacheForTests() {
  historyCache.clear()
  inFlightHistoryRequests.clear()
}
