import type { NextRequest } from 'next/server'
import { ENV } from '@/lib/server/core/env'
import { parseFavoritesRequest } from '@/lib/server/favorites/favoritesRequest'
import {
  clearFavoritesRateLimitForTests,
  checkFavoritesRateLimit,
} from '@/lib/server/favorites/favoritesRateLimit'
import {
  clearFavoritesStateForTests,
  FavoritesLookupBatchError,
  getFavoritesResponse,
} from '@/lib/server/favorites/favoritesService'
import { jsonResponse } from '@/lib/server/core/httpResponse'
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
import type { FavoritesErrorCode, FavoritesErrorResponse } from '@/lib/favorites'
import { QuoteUpstreamBudgetError } from '@/lib/server/quote/protectedQuoteLookup'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

const FAVORITES_ROUTE = '/api/favorites'

function recordFavoritesRequest(
  startedAt: number,
  status: number,
  outcome: string,
  source: string
) {
  recordApiRequest({
    endpoint: FAVORITES_ROUTE,
    method: 'GET',
    outcome,
    source,
    startedAt,
    status,
  })
}

function favoritesErrorResponse(
  error: FavoritesErrorCode,
  init: ResponseInit,
  details?: string,
  requestId?: string,
  options: {
    missingItems?: string[]
    failedItems?: string[]
  } = {}
) {
  const body: FavoritesErrorResponse = {
    ok: false,
    error,
    ...(requestId ? { requestId } : {}),
    ...(details ? { details } : {}),
    ...(options.missingItems ? { missingItems: options.missingItems } : {}),
    ...(options.failedItems ? { failedItems: options.failedItems } : {}),
  }

  return jsonResponse(body, init, requestId)
}

export function clearFavoritesCacheForTests() {
  clearFavoritesStateForTests()
  clearFavoritesRateLimitForTests()
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const parsedRequest = parseFavoritesRequest(req)
  const dataSource = ENV.MARKET_DATA_SOURCE

  if (!parsedRequest.ok) {
    const status = 400

    recordFavoritesRequest(startedAt, status, 'error', dataSource)

    return favoritesErrorResponse(parsedRequest.error, { status }, undefined, requestId)
  }

  const rateLimitCheck = await safeCheckRateLimit(
    () => checkFavoritesRateLimit(req),
    {
      requestId,
      route: '/api/favorites',
    }
  )

  if (!rateLimitCheck.ok) {
    recordFavoritesRequest(
      startedAt,
      503,
      'rate-limit-unavailable',
      dataSource
    )

    return favoritesErrorResponse(
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
  const rateLimitIdentity = resolveRateLimitIdentity(
    req.headers,
    req.nextUrl.hostname
  )

  if (!rateLimit.ok) {
    recordFavoritesRequest(startedAt, 429, 'rate-limited', dataSource)

    return favoritesErrorResponse(
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
    const response = await getFavoritesResponse(parsedRequest.items, {
      bypassCache: parsedRequest.bypassCache,
      rateLimitIdentity,
      requestId,
    })

    recordFavoritesRequest(startedAt, 200, 'success', response.source)

    return jsonResponse(response, {
      headers: withRequestIdHeaders(rateLimit.headers, requestId),
    }, requestId)
  } catch (error: unknown) {
    const isProd = ENV.NODE_ENV === 'production'

    if (error instanceof QuoteUpstreamBudgetError) {
      recordFavoritesRequest(
        startedAt,
        error.status,
        'rate-limited',
        dataSource
      )

      return favoritesErrorResponse(
        error.code,
        {
          status: error.status,
          headers: withRequestIdHeaders(
            { ...rateLimit.headers, ...error.headers },
            requestId
          ),
        },
        undefined,
        requestId
      )
    }

    logServerError('api.favorites.GET', error, {
      requestId,
      route: '/api/favorites',
      items: parsedRequest.items.map((item) => `${item.market}:${item.symbol}`),
    })
    recordFavoritesRequest(startedAt, 502, 'error', dataSource)

    return favoritesErrorResponse(
      'FAVORITES_ERROR',
      { status: 502 },
      isProd ? undefined : getSafeErrorDetails(error),
      requestId,
      error instanceof FavoritesLookupBatchError
        ? {
            missingItems: error.missingItems,
            failedItems: error.failedItems,
          }
        : {}
    )
  }
}

export function POST(req: NextRequest) {
  const requestId = getRequestId(req)

  recordApiRequest({
    endpoint: FAVORITES_ROUTE,
    method: 'POST',
    outcome: 'method-not-allowed',
    source: ENV.MARKET_DATA_SOURCE,
    status: 405,
  })

  return favoritesErrorResponse(
    'METHOD_NOT_ALLOWED',
    {
      status: 405,
      headers: withRequestIdHeaders({ Allow: 'GET' }, requestId),
    },
    undefined,
    requestId
  )
}
