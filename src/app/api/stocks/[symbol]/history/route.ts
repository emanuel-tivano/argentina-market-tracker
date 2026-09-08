import { type NextRequest } from 'next/server'
import { ENV } from '@/lib/server/core/env'
import { checkHistoryRateLimit } from '@/lib/server/history/historyRateLimit'
import { historyErrorResponse, jsonHistoryResponse } from '@/lib/server/history/historyResponse'
import {
  getHistoryCacheSizeForTests as getHistoryCacheSize,
  getOrCreateHistoryResponse,
  logHistoryRequestParams,
} from '@/lib/server/history/historyService'
import {
  getRequestId,
  getSafeErrorDetails,
  logServerError,
  recordApiRequest,
  withRequestIdHeaders,
} from '@/lib/server/core/observability'
import { getRetryAfterHeaders, safeCheckRateLimit } from '@/lib/server/core/rateLimit'
import {
  DEFAULT_STOCK_HISTORY_MARKET,
  DEFAULT_STOCK_HISTORY_RANGE,
  isStockHistoryMarket,
  isStockHistoryRange,
} from '@/lib/stockHistory'
import { parseStockSymbolParam } from '@/lib/stockSymbol'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

const HISTORY_ROUTE = '/api/stocks/[symbol]/history'

function recordHistoryRequest(
  startedAt: number,
  status: number,
  outcome: string,
  source: string
) {
  recordApiRequest({
    endpoint: HISTORY_ROUTE,
    method: 'GET',
    outcome,
    source,
    startedAt,
    status,
  })
}

type RouteContext = {
  params: Promise<{ symbol: string }>
}

function parseHistoryRequest(
  req: NextRequest,
  params: { symbol: string }
) {
  const symbol = parseStockSymbolParam(params.symbol)
  const market = (
    req.nextUrl.searchParams.get('market') ?? DEFAULT_STOCK_HISTORY_MARKET
  ).trim()
  const range =
    req.nextUrl.searchParams.get('range') ?? DEFAULT_STOCK_HISTORY_RANGE

  if (!symbol) {
    return { ok: false as const, error: 'INVALID_SYMBOL' as const }
  }

  if (!isStockHistoryMarket(market)) {
    return { ok: false as const, error: 'INVALID_MARKET' as const }
  }

  if (!isStockHistoryRange(range)) {
    return { ok: false as const, error: 'INVALID_RANGE' as const }
  }

  return { ok: true as const, symbol, market, range }
}

export function getHistoryCacheSizeForTests() {
  return getHistoryCacheSize()
}

export async function GET(req: NextRequest, context: RouteContext) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const params = await context.params
  const parsedRequest = parseHistoryRequest(req, params)
  const dataSource = ENV.MARKET_DATA_SOURCE

  logHistoryRequestParams({
    rawParams: params,
    symbolParam: params.symbol,
    normalizedSymbol: parsedRequest.ok ? parsedRequest.symbol : null,
    rangeParam: req.nextUrl.searchParams.get('range'),
    normalizedRange: parsedRequest.ok ? parsedRequest.range : null,
    marketParam: req.nextUrl.searchParams.get('market'),
    normalizedMarket: parsedRequest.ok ? parsedRequest.market : null,
    url: req.nextUrl.pathname + req.nextUrl.search,
  })

  if (!parsedRequest.ok) {
    recordHistoryRequest(startedAt, 400, 'error', dataSource)
    return historyErrorResponse(
      parsedRequest.error,
      { status: 400 },
      undefined,
      requestId
    )
  }

  const rateLimitCheck = await safeCheckRateLimit(
    () => checkHistoryRateLimit(req),
    {
      requestId,
      route: HISTORY_ROUTE,
    }
  )

  if (!rateLimitCheck.ok) {
    recordHistoryRequest(
      startedAt,
      503,
      'rate-limit-unavailable',
      dataSource
    )
    return historyErrorResponse(
      'RATE_LIMIT_UNAVAILABLE',
      {
        status: rateLimitCheck.status,
        headers: withRequestIdHeaders(
          { 'Retry-After': String(rateLimitCheck.retryAfterSec) },
          requestId
        ),
      },
      undefined,
      requestId
    )
  }

  const rateLimit = rateLimitCheck.rateLimit

  if (!rateLimit.ok) {
    recordHistoryRequest(startedAt, 429, 'rate-limited', dataSource)
    return historyErrorResponse(
      'RATE_LIMITED',
      {
        status: 429,
        headers: withRequestIdHeaders(getRetryAfterHeaders(rateLimit), requestId),
      },
      undefined,
      requestId
    )
  }

  try {
    const response = await getOrCreateHistoryResponse(
      parsedRequest.symbol,
      parsedRequest.market,
      parsedRequest.range,
      { requestId }
    )
    recordHistoryRequest(startedAt, 200, 'success', response.meta.source)

    return jsonHistoryResponse(
      {
        ...response,
        meta: {
          ...response.meta,
          requestId,
        },
      },
      {
        headers: withRequestIdHeaders(rateLimit.headers, requestId),
      },
      requestId
    )
  } catch (err: unknown) {
    const isProd = ENV.NODE_ENV === 'production'

    logServerError('api.stocks.history.GET', err, {
      requestId,
      route: HISTORY_ROUTE,
      symbol: parsedRequest.symbol,
      market: parsedRequest.market,
      range: parsedRequest.range,
    })
    recordHistoryRequest(startedAt, 502, 'error', dataSource)

    return historyErrorResponse(
      'HISTORY_ERROR',
      { status: 502 },
      isProd ? undefined : getSafeErrorDetails(err),
      requestId
    )
  }
}

export function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  recordApiRequest({
    endpoint: HISTORY_ROUTE,
    method: 'POST',
    outcome: 'method-not-allowed',
    source: ENV.MARKET_DATA_SOURCE,
    status: 405,
  })

  return historyErrorResponse(
    'METHOD_NOT_ALLOWED',
    {
      status: 405,
      headers: withRequestIdHeaders({ Allow: 'GET' }, requestId),
    },
    undefined,
    requestId
  )
}
