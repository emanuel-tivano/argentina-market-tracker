import 'server-only'

import type { PanelTitulo } from '@/lib/panel'
import { ENV } from '@/lib/server/core/env'
import { incrementMetricCounter } from '@/lib/server/core/observability'
import type { StockHistoryMarket } from '@/lib/stockHistory'

const QUOTE_CACHE_MAX_KEYS = 500

export type QuoteCacheEntryValue = {
  data: PanelTitulo
  fetchedAt: string
}

type QuoteCacheEntry = QuoteCacheEntryValue & {
  freshUntil: number
  staleUntil: number
}

const quoteCache = new Map<string, QuoteCacheEntry>()
// Cotizacion and CotizacionDetalle are distinct resources: never share 404s.
const quoteNotFoundCache = new Map<string, number>()
const inFlightQuoteRequests = new Map<string, Promise<QuoteCacheEntryValue>>()

function getCacheKey(market: StockHistoryMarket, symbol: string): string {
  return `${market}:${symbol}`
}

function pruneQuoteCache(now = Date.now()) {
  for (const [key, expiresAt] of quoteNotFoundCache) {
    if (now >= expiresAt) quoteNotFoundCache.delete(key)
  }
  const negativeEntries = [...quoteNotFoundCache.entries()].sort(
    ([, first], [, second]) => first - second
  )
  for (const [key] of negativeEntries.slice(
    0,
    Math.max(0, negativeEntries.length - QUOTE_CACHE_MAX_KEYS)
  )) {
    quoteNotFoundCache.delete(key)
  }

  for (const [key, entry] of quoteCache) {
    if (now >= entry.staleUntil) {
      quoteCache.delete(key)
    }
  }

  if (quoteCache.size <= QUOTE_CACHE_MAX_KEYS) {
    return
  }

  const entriesByOldestExpiry = [...quoteCache.entries()].sort(
    ([, first], [, second]) => first.staleUntil - second.staleUntil
  )

  for (const [key] of entriesByOldestExpiry.slice(
    0,
    quoteCache.size - QUOTE_CACHE_MAX_KEYS
  )) {
    quoteCache.delete(key)
  }
}

export function getCachedQuote(
  market: StockHistoryMarket,
  symbol: string
): QuoteCacheEntryValue | null {
  pruneQuoteCache()

  const cacheKey = getCacheKey(market, symbol)
  const cached = quoteCache.get(cacheKey)

  if (!cached || Date.now() >= cached.staleUntil) {
    quoteCache.delete(cacheKey)
    incrementMetricCounter('favorites.quote_cache.event.total', 1, {
      event: 'miss',
      market,
    })
    return null
  }

  if (Date.now() >= cached.freshUntil) {
    incrementMetricCounter('favorites.quote_cache.event.total', 1, {
      event: 'stale-window-miss',
      market,
    })
    return null
  }

  incrementMetricCounter('favorites.quote_cache.event.total', 1, {
    event: 'hit',
    market,
  })

  return {
    data: cached.data,
    fetchedAt: cached.fetchedAt,
  }
}

export function getStaleQuote(
  market: StockHistoryMarket,
  symbol: string
): QuoteCacheEntryValue | null {
  pruneQuoteCache()

  const cacheKey = getCacheKey(market, symbol)
  const cached = quoteCache.get(cacheKey)

  if (!cached || Date.now() >= cached.staleUntil) {
    quoteCache.delete(cacheKey)
    incrementMetricCounter('favorites.quote_cache.event.total', 1, {
      event: 'stale-miss',
      market,
    })
    return null
  }

  incrementMetricCounter('favorites.quote_cache.event.total', 1, {
    event: 'stale-hit',
    market,
  })

  return {
    data: cached.data,
    fetchedAt: cached.fetchedAt,
  }
}

export function setCachedQuote(
  market: StockHistoryMarket,
  symbol: string,
  value: QuoteCacheEntryValue
) {
  quoteNotFoundCache.delete(getCacheKey(market, symbol))
  quoteCache.set(getCacheKey(market, symbol), {
    ...value,
    freshUntil: Date.now() + ENV.STOCK_QUOTE_FRESH_TTL_MS,
    staleUntil: Date.now() + ENV.STOCK_QUOTE_STALE_TTL_MS,
  })
  pruneQuoteCache()
  incrementMetricCounter('favorites.quote_cache.event.total', 1, {
    event: 'write',
    market,
  })
}

export function hasCachedQuoteNotFound(
  market: StockHistoryMarket,
  symbol: string
): boolean {
  pruneQuoteCache()
  return quoteNotFoundCache.has(getCacheKey(market, symbol))
}

export function setCachedQuoteNotFound(
  market: StockHistoryMarket,
  symbol: string
) {
  quoteNotFoundCache.set(
    getCacheKey(market, symbol),
    Date.now() + ENV.STOCK_QUOTE_NOT_FOUND_TTL_MS
  )
  pruneQuoteCache()
}

export function getOrCreateInFlightQuoteRequest(
  market: StockHistoryMarket,
  symbol: string,
  factory: () => Promise<QuoteCacheEntryValue>
) {
  const cacheKey = getCacheKey(market, symbol)
  const inFlight = inFlightQuoteRequests.get(cacheKey)

  if (inFlight) {
    incrementMetricCounter('favorites.quote_cache.event.total', 1, {
      event: 'inflight-hit',
      market,
    })
    return inFlight
  }

  const promise = factory().finally(() => {
    if (inFlightQuoteRequests.get(cacheKey) === promise) {
      inFlightQuoteRequests.delete(cacheKey)
    }
  })

  inFlightQuoteRequests.set(cacheKey, promise)
  return promise
}

export function clearQuoteCacheForTests() {
  quoteCache.clear()
  quoteNotFoundCache.clear()
  inFlightQuoteRequests.clear()
}
