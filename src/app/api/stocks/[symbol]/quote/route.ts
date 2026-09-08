import { type NextRequest } from 'next/server'
import { ENV } from '@/lib/server/core/env'
import { jsonNoStoreResponse } from '@/lib/server/core/httpResponse'
import {
  getRequestId,
  getSafeErrorDetails,
  logServerError,
  recordApiRequest,
  withRequestIdHeaders,
} from '@/lib/server/core/observability'
import {
  getRetryAfterHeaders,
  resolveRateLimitIdentity,
  safeCheckRateLimit,
} from '@/lib/server/core/rateLimit'
import { clearStockQuoteCacheForTests } from '@/lib/server/quote/quoteCache'
import {
  checkQuotePublicRequestRateLimit,
  clearQuoteRateLimitForTests,
} from '@/lib/server/quote/quoteRateLimit'
import {
  getStockQuoteResponse,
  StockQuoteRateLimitError,
} from '@/lib/server/quote/quoteService'
import { IolUpstreamHttpError } from '@/lib/server/upstream/iol'
import {
  DEFAULT_STOCK_HISTORY_MARKET,
  isStockHistoryMarket,
} from '@/lib/stockHistory'
import type { StockQuoteErrorCode } from '@/lib/stockQuote'
import { parseStockSymbolParam } from '@/lib/stockSymbol'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ symbol: string }>
}

const QUOTE_ROUTE = '/api/stocks/[symbol]/quote'

type ErrorResponseOptions = {
  details?: string
  headers?: HeadersInit
}

function errorResponse(
  error: StockQuoteErrorCode,
  status: number,
  requestId: string,
  options: ErrorResponseOptions = {}
) {
  return jsonNoStoreResponse(
    {
      ok: false,
      error,
      requestId,
      ...(options.details ? { details: options.details } : {}),
    },
    {
      status,
      headers: withRequestIdHeaders(options.headers, requestId),
    },
    requestId
  )
}

function recordQuoteRequest(
  startedAt: number,
  method: 'GET' | 'POST',
  status: number,
  outcome: string,
  source: string
) {
  recordApiRequest({
    endpoint: QUOTE_ROUTE,
    method,
    outcome,
    source,
    startedAt,
    status,
  })
}

export function clearQuoteStateForTests() {
  clearStockQuoteCacheForTests()
  clearQuoteRateLimitForTests()
}

export async function GET(req: NextRequest, context: RouteContext) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const params = await context.params
  const symbol = parseStockSymbolParam(params.symbol)
  const market = (
    req.nextUrl.searchParams.get('market') ?? DEFAULT_STOCK_HISTORY_MARKET
  ).trim()
  const dataSource = ENV.MARKET_DATA_SOURCE

  if (!symbol) {
    recordQuoteRequest(startedAt, 'GET', 400, 'error', dataSource)
    return errorResponse('INVALID_SYMBOL', 400, requestId)
  }

  if (!isStockHistoryMarket(market)) {
    recordQuoteRequest(startedAt, 'GET', 400, 'error', dataSource)
    return errorResponse('INVALID_MARKET', 400, requestId)
  }

  const rateLimitIdentity = resolveRateLimitIdentity(
    req.headers,
    req.nextUrl.hostname
  )
  const publicRateLimitCheck = await safeCheckRateLimit(
    () => checkQuotePublicRequestRateLimit(rateLimitIdentity),
    { requestId, route: QUOTE_ROUTE }
  )

  if (!publicRateLimitCheck.ok) {
    recordQuoteRequest(
      startedAt,
      'GET',
      publicRateLimitCheck.status,
      'rate-limit-unavailable',
      dataSource
    )
    return errorResponse(
      'RATE_LIMIT_UNAVAILABLE',
      publicRateLimitCheck.status,
      requestId,
      {
        headers: {
          'Retry-After': String(publicRateLimitCheck.retryAfterSec),
        },
      }
    )
  }

  const publicRateLimit = publicRateLimitCheck.rateLimit

  if (!publicRateLimit.ok) {
    recordQuoteRequest(
      startedAt,
      'GET',
      429,
      'rate-limited',
      dataSource
    )
    return errorResponse('RATE_LIMITED', 429, requestId, {
      headers: getRetryAfterHeaders(publicRateLimit),
    })
  }

  const publicRateLimitHeaders = publicRateLimit.headers

  try {
    const result = await getStockQuoteResponse(symbol, market, {
      rateLimitIdentity,
      requestId,
      route: QUOTE_ROUTE,
    })

    if (!result.response) {
      recordQuoteRequest(startedAt, 'GET', 404, 'not-found', dataSource)
      return errorResponse('QUOTE_NOT_FOUND', 404, requestId, {
        headers: publicRateLimitHeaders,
      })
    }

    recordQuoteRequest(
      startedAt,
      'GET',
      200,
      'success',
      result.response.source
    )
    return jsonNoStoreResponse(
      result.response,
      {
        headers: {
          ...publicRateLimitHeaders,
          'X-Quote-Cache': result.cacheStatus,
        },
      },
      requestId
    )
  } catch (error: unknown) {
    if (error instanceof StockQuoteRateLimitError) {
      recordQuoteRequest(
        startedAt,
        'GET',
        error.status,
        error.code === 'RATE_LIMITED'
          ? 'rate-limited'
          : 'rate-limit-unavailable',
        dataSource
      )
      return errorResponse(error.code, error.status, requestId, {
        headers: {
          ...publicRateLimitHeaders,
          ...error.headers,
        },
      })
    }

    if (error instanceof IolUpstreamHttpError && error.status === 404) {
      recordQuoteRequest(startedAt, 'GET', 404, 'not-found', dataSource)
      return errorResponse('QUOTE_NOT_FOUND', 404, requestId, {
        headers: publicRateLimitHeaders,
      })
    }

    logServerError('api.stocks.quote.GET', error, {
      requestId,
      route: QUOTE_ROUTE,
      symbol,
      market,
    })
    recordQuoteRequest(startedAt, 'GET', 502, 'error', dataSource)

    return errorResponse(
      'QUOTE_ERROR',
      502,
      requestId,
      {
        details:
          ENV.NODE_ENV === 'production'
            ? undefined
            : getSafeErrorDetails(error),
        headers: publicRateLimitHeaders,
      }
    )
  }
}

export function POST(req: NextRequest) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  recordQuoteRequest(
    startedAt,
    'POST',
    405,
    'method-not-allowed',
    ENV.MARKET_DATA_SOURCE
  )

  return errorResponse('METHOD_NOT_ALLOWED', 405, requestId, {
    headers: { Allow: 'GET' },
  })
}
