import 'server-only'

import { ENV } from '@/lib/server/core/env'
import { getDemoQuoteDetailBySymbol } from '@/lib/server/demo/demoMarketData'
import {
  IolUpstreamHttpError,
  iolFetch,
  isRecoverableIolUpstreamError,
} from '@/lib/server/upstream/iol'
import { getQuoteDetailEndpoint } from '@/lib/server/upstream/quoteEndpoint'
import {
  getCachedStockQuoteResponse,
  getOrCreateInFlightStockQuoteRequest,
  getStaleStockQuoteResponse,
  hasCachedStockQuoteNotFound,
  setCachedStockQuoteNotFound,
  setCachedStockQuoteResponse,
} from '@/lib/server/quote/quoteCache'
import {
  getSafeErrorDetails,
  incrementMetricCounter,
  logServerWarn,
} from '@/lib/server/core/observability'
import {
  type RateLimitIdentity,
} from '@/lib/server/core/rateLimit'
import {
  executeProtectedQuoteLookup,
  QuoteUpstreamBudgetError,
} from '@/lib/server/quote/protectedQuoteLookup'
import {
  hasMatchingStockQuoteIdentity,
  normalizeStockQuoteDetail,
  StockQuoteNormalizationError,
  type StockQuoteSuccessResponse,
} from '@/lib/stockQuote'
import type { StockHistoryMarket } from '@/lib/stockHistory'

export type StockQuoteCacheStatus =
  | 'fresh'
  | 'memory-cache'
  | 'negative-cache'
  | 'stale'

export type StockQuoteServiceResult = {
  cacheStatus: StockQuoteCacheStatus
  response: StockQuoteSuccessResponse | null
}

export type StockQuoteRequestContext = {
  rateLimitIdentity: RateLimitIdentity
  requestId?: string
  route: string
}

export { QuoteUpstreamBudgetError as StockQuoteRateLimitError }

async function fetchStockQuoteResponse(
  symbol: string,
  market: StockHistoryMarket
): Promise<Pick<StockQuoteSuccessResponse, 'data' | 'source'> | null> {

  if (ENV.MARKET_DATA_SOURCE === 'demo') {
    const data = getDemoQuoteDetailBySymbol(symbol, market)

    return data
      ? {
          data,
          source: 'demo',
        }
      : null
  }

  const payload = await iolFetch(getQuoteDetailEndpoint(market, symbol))
  const data = normalizeStockQuoteDetail(payload, symbol)

  if (!hasMatchingStockQuoteIdentity(data, symbol, market)) {
    throw new StockQuoteNormalizationError(
      'Upstream quote identity does not match the requested quote'
    )
  }

  return {
    data,
    source: 'live',
  }
}

function canUseStaleQuoteFallback(error: unknown): boolean {
  if (error instanceof QuoteUpstreamBudgetError) {
    return true
  }

  return (
    error instanceof StockQuoteNormalizationError ||
    isRecoverableIolUpstreamError(error, { allowNotFound: true })
  )
}

export async function getStockQuoteResponse(
  symbol: string,
  market: StockHistoryMarket,
  context: StockQuoteRequestContext
): Promise<StockQuoteServiceResult> {
  const normalizedSymbol = symbol.trim().toUpperCase()
  const normalizedMarket = market.trim() as StockHistoryMarket

  const cached = getCachedStockQuoteResponse(
    normalizedMarket,
    normalizedSymbol
  )

  if (cached) {
    incrementMetricCounter('quote.response.total', 1, {
      cacheStatus: 'memory-cache',
      market,
      source: cached.source,
      stale: false,
    })
    return {
      cacheStatus: 'memory-cache',
      response: cached,
    }
  }

  const staleSnapshot = getStaleStockQuoteResponse(
    normalizedMarket,
    normalizedSymbol
  )

  if (
    ENV.MARKET_DATA_SOURCE === 'live' &&
    hasCachedStockQuoteNotFound(normalizedMarket, normalizedSymbol)
  ) {
    if (staleSnapshot) {
      return {
        cacheStatus: 'stale',
        response: staleSnapshot,
      }
    }

    return {
      cacheStatus: 'negative-cache',
      response: null,
    }
  }

  try {
    const response = await getOrCreateInFlightStockQuoteRequest(
      normalizedMarket,
      normalizedSymbol,
      async () => {
        const fetched =
          ENV.MARKET_DATA_SOURCE === 'demo'
            ? await fetchStockQuoteResponse(normalizedSymbol, normalizedMarket)
            : await executeProtectedQuoteLookup({
                context,
                market: normalizedMarket,
                symbol: normalizedSymbol,
                lookup: () =>
                  fetchStockQuoteResponse(normalizedSymbol, normalizedMarket),
              })

        if (fetched) {
          return setCachedStockQuoteResponse(
            normalizedMarket,
            normalizedSymbol,
            fetched,
            Date.now()
          )
        }

        return null
      }
    )

    incrementMetricCounter('quote.response.total', 1, {
      cacheStatus: 'fresh',
      market,
      source: response?.source ?? ENV.MARKET_DATA_SOURCE,
      stale: false,
    })
    return {
      cacheStatus: 'fresh',
      response,
    }
  } catch (error: unknown) {
    const stale = getStaleStockQuoteResponse(
      normalizedMarket,
      normalizedSymbol
    )

    if (stale && canUseStaleQuoteFallback(error)) {
      logServerWarn('quote.stale-fallback', {
        requestId: context.requestId,
        symbol: normalizedSymbol,
        market: normalizedMarket,
        reason: getSafeErrorDetails(error),
      })
      incrementMetricCounter('quote.stale_fallback.total', 1, {
        market: normalizedMarket,
        source: stale.source,
      })
      incrementMetricCounter('quote.response.total', 1, {
        cacheStatus: 'stale',
        market: normalizedMarket,
        source: stale.source,
        stale: true,
      })

      return {
        cacheStatus: 'stale',
        response: stale,
      }
    }

    if (
      ENV.MARKET_DATA_SOURCE === 'live' &&
      error instanceof IolUpstreamHttpError &&
      error.status === 404
    ) {
      setCachedStockQuoteNotFound(normalizedMarket, normalizedSymbol)
      return {
        cacheStatus: 'fresh',
        response: null,
      }
    }

    throw error
  }
}
