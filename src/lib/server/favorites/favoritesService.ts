import 'server-only'

import {
  buildFavoriteLookupKey,
  type FavoriteLookupItem,
  type FavoritesSuccessResponse,
} from '@/lib/favorites'
import { normalizeQuoteData, type PanelTitulo } from '@/lib/panel'
import {
  getDemoQuoteBySymbol,
} from '@/lib/server/demo/demoMarketData'
import { ENV } from '@/lib/server/core/env'
import { getQuoteBySymbol, IolUpstreamHttpError } from '@/lib/server/upstream/iol'
import { isRecoverableIolUpstreamError } from '@/lib/server/upstream/iol'
import {
  clearQuoteCacheForTests,
  getCachedQuote,
  getOrCreateInFlightQuoteRequest,
  getStaleQuote,
  hasCachedQuoteNotFound,
  setCachedQuote,
  setCachedQuoteNotFound,
} from '@/lib/server/upstream/quoteCache'
import {
  getSafeErrorDetails,
  incrementMetricCounter,
  logServerWarn,
} from '@/lib/server/core/observability'
import type { StockHistoryMarket } from '@/lib/stockHistory'
import type { RateLimitIdentity } from '@/lib/server/core/rateLimit'
import { QuoteUpstreamBudgetError } from '@/lib/server/quote/protectedQuoteLookup'

type FavoriteQuoteResolution =
  | {
      kind: 'row'
      itemKey: string
      row: PanelTitulo
      fetchedAt: string
      stale: boolean
    }
  | {
      kind: 'missing'
      itemKey: string
    }
  | {
      kind: 'failed'
      itemKey: string
      reason: string
      error: unknown
    }

export class FavoritesLookupBatchError extends Error {
  constructor(
    message: string,
    public readonly failedItems: string[],
    public readonly missingItems: string[]
  ) {
    super(message)
    this.name = 'FavoritesLookupBatchError'
  }
}

function dedupeFavoriteItems(items: FavoriteLookupItem[]): FavoriteLookupItem[] {
  const itemsByKey = new Map<string, FavoriteLookupItem>()

  for (const item of items) {
    itemsByKey.set(buildFavoriteLookupKey(item), item)
  }

  return [...itemsByKey.values()]
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  iteratee: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (items.length === 0) {
    return []
  }

  const results = new Array<TOutput>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  )

  return results
}

async function fetchLiveQuote(
  market: StockHistoryMarket,
  symbol: string,
  options: {
    rateLimitIdentity: RateLimitIdentity
    requestId?: string
  }
) {
  let data: unknown
  try {
    data = await getQuoteBySymbol(market, symbol, {
      rateLimitIdentity: options.rateLimitIdentity,
      requestId: options.requestId,
      route: '/api/favorites',
    })
  } catch (error: unknown) {
    // Write once inside the deduplicated lookup, before any stale fallback.
    if (error instanceof IolUpstreamHttpError && error.status === 404) {
      setCachedQuoteNotFound(market, symbol)
    }
    throw error
  }
  const row = normalizeQuoteData(data, { symbol })
  const fetchedAt = new Date().toISOString()

  const value = {
    data: row,
    fetchedAt,
  }

  setCachedQuote(market, symbol, value)
  return value
}

async function getQuoteRow(
  market: StockHistoryMarket,
  symbol: string,
  options: {
    bypassCache: boolean
    rateLimitIdentity: RateLimitIdentity
    requestId?: string
  }
): Promise<FavoriteQuoteResolution> {
  const itemKey = buildFavoriteLookupKey({ market, symbol })

  if (ENV.MARKET_DATA_SOURCE === 'demo') {
    const demoQuote = getDemoQuoteBySymbol(symbol)

    return demoQuote
      ? {
          kind: 'row',
          itemKey,
          row: demoQuote,
          fetchedAt: new Date().toISOString(),
          stale: false,
        }
      : {
          kind: 'missing',
          itemKey,
        }
  }

  if (!options.bypassCache) {
    const cached = getCachedQuote(market, symbol)

    if (cached) {
      return {
        kind: 'row',
        itemKey,
        row: cached.data,
        fetchedAt: cached.fetchedAt,
        stale: false,
      }
    }
  }

  // A manual refresh bypasses positive freshness, but not a confirmed 404 TTL.
  if (hasCachedQuoteNotFound(market, symbol)) {
    const stale = getStaleQuote(market, symbol)
    return stale
      ? {
          kind: 'row',
          itemKey,
          row: stale.data,
          fetchedAt: stale.fetchedAt,
          stale: true,
        }
      : { kind: 'missing', itemKey }
  }

  try {
    const value = await getOrCreateInFlightQuoteRequest(market, symbol, () =>
      fetchLiveQuote(market, symbol, options)
    )

    return {
      kind: 'row',
      itemKey,
      row: value.data,
      fetchedAt: value.fetchedAt,
      stale: false,
    }
  } catch (error: unknown) {
    const stale = getStaleQuote(market, symbol)
    const recoverable =
      error instanceof QuoteUpstreamBudgetError ||
      isRecoverableIolUpstreamError(error, { allowNotFound: true })

    if (stale && recoverable) {
      logServerWarn('favorites.quote.stale-fallback', {
        requestId: options.requestId,
        market,
        symbol,
        reason: getSafeErrorDetails(error),
      })

      return {
        kind: 'row',
        itemKey,
        row: stale.data,
        fetchedAt: stale.fetchedAt,
        stale: true,
      }
    }

    if (!(error instanceof IolUpstreamHttpError) && !recoverable) {
      throw error
    }

    if (
      error instanceof IolUpstreamHttpError &&
      error.status === 404
    ) {
      return {
        kind: 'missing',
        itemKey,
      }
    }

    logServerWarn('favorites.quote.lookup.failed', {
      requestId: options.requestId,
      market,
      symbol,
      reason: getSafeErrorDetails(error),
      status:
        error instanceof IolUpstreamHttpError
          ? error.status
          : undefined,
      upstreamPath:
        error instanceof IolUpstreamHttpError
          ? error.upstreamPath
          : undefined,
    })

    return {
      kind: 'failed',
      itemKey,
      reason: getSafeErrorDetails(error) ?? 'unknown',
      error,
    }
  }
}

async function resolveQuoteRow(
  item: FavoriteLookupItem,
  options: {
    bypassCache: boolean
    rateLimitIdentity: RateLimitIdentity
    requestId?: string
  }
): Promise<FavoriteQuoteResolution> {
  return getQuoteRow(item.market, item.symbol, options)
}

export async function getFavoritesResponse(
  items: FavoriteLookupItem[],
  options: {
    bypassCache: boolean
    rateLimitIdentity: RateLimitIdentity
    requestId?: string
  }
): Promise<FavoritesSuccessResponse> {
  const uniqueItems = dedupeFavoriteItems(items)
  const concurrencyLimit = ENV.FAVORITES_QUOTE_CONCURRENCY
  const results = await mapWithConcurrency(
    uniqueItems,
    concurrencyLimit,
    (item) =>
      resolveQuoteRow(item, {
        bypassCache: options.bypassCache,
        rateLimitIdentity: options.rateLimitIdentity,
        requestId: options.requestId,
      })
  )

  const rows: PanelTitulo[] = []
  const missingItems: string[] = []
  const failedItems: string[] = []
  const failedErrors: unknown[] = []
  const servedAt = new Date().toISOString()
  let latestFetchedAt: string | undefined
  let stale = false

  for (const result of results) {
    if (result.kind === 'row') {
      rows.push(result.row)
      stale ||= result.stale

      if (!latestFetchedAt || result.fetchedAt > latestFetchedAt) {
        latestFetchedAt = result.fetchedAt
      }

      continue
    }

    if (result.kind === 'missing') {
      missingItems.push(result.itemKey)
      continue
    }

    failedItems.push(result.itemKey)
    failedErrors.push(result.error)
  }

  incrementMetricCounter('favorites.batch.total', 1, {
    batchSize: items.length,
    uniqueItemCount: uniqueItems.length,
    concurrencyLimit,
    failedCount: failedItems.length,
    source: ENV.MARKET_DATA_SOURCE,
  })

  if (rows.length === 0 && failedItems.length > 0) {
    const budgetError = failedErrors.find(
      (error): error is QuoteUpstreamBudgetError =>
        error instanceof QuoteUpstreamBudgetError
    )

    if (
      budgetError &&
      failedErrors.every(
        (error) =>
          error instanceof QuoteUpstreamBudgetError &&
          error.code === budgetError.code
      )
    ) {
      throw budgetError
    }

    throw new FavoritesLookupBatchError(
      `Favorites quote lookup failed for: ${failedItems.join(', ')}`,
      failedItems,
      missingItems
    )
  }

  incrementMetricCounter('favorites.response.total', 1, {
    concurrencyLimit,
    source: ENV.MARKET_DATA_SOURCE,
    stale,
  })

  return {
    ok: true,
    rows,
    missingItems,
    failedItems,
    source: ENV.MARKET_DATA_SOURCE,
    requestId: options.requestId,
    updatedAt: latestFetchedAt ?? servedAt,
    servedAt,
    stale,
  }
}

export function clearFavoritesStateForTests() {
  clearQuoteCacheForTests()
}
