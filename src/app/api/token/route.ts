import { NextResponse, type NextRequest } from 'next/server'
import { canUseLocalDebug } from '@/lib/server/core/debug'
import { getCachedToken } from '@/lib/server/upstream/tokenCache'
import {
  getRequestId,
  getSafeErrorDetails,
  logServerError,
  withRequestIdHeaders,
} from '@/lib/server/core/observability'
import {
  IolTokenFormatError,
  IolTokenUpstreamError,
  refreshTokenForDebug,
} from '@/lib/server/upstream/iol'

function notFound(requestId: string) {
  return NextResponse.json(
    {
      ok: false,
      error: 'NOT_FOUND',
      requestId,
    },
    {
      status: 404,
      headers: withRequestIdHeaders(undefined, requestId),
    }
  )
}

function isSafeTokenType(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 32 &&
    /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
  )
}

// Explicitly authorized non-production debug only: never expose full OAuth tokens.
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req)

  if (!canUseLocalDebug(req)) {
    return notFound(requestId)
  }

  const cached = getCachedToken()

  if (!cached) {
    return POST(req, requestId)
  }

  return NextResponse.json({
    ok: true,
    cached: true,
    expires_in: null,
    status: 'cached',
    message: 'Token is cached',
  }, {
    headers: withRequestIdHeaders(undefined, requestId),
  })
}

export async function POST(req: NextRequest, requestId = getRequestId(req)) {

  if (!canUseLocalDebug(req)) {
    return notFound(requestId)
  }

  try {
    const token = await refreshTokenForDebug()

    return NextResponse.json({
      ok: true,
      expires_in: token.expiresIn,
      ...(isSafeTokenType(token.tokenType) ? { token_type: token.tokenType } : {}),
      cached: false,
      status: 'refreshed',
      message: 'Token fetched and cached',
    }, {
      headers: withRequestIdHeaders(undefined, requestId),
    })
  } catch (err: unknown) {
    if (err instanceof IolTokenUpstreamError) {
      logServerError('api.token.POST', err, {
        requestId,
        route: '/api/token',
        errorCode: 'TOKEN_UPSTREAM',
        status: err.status,
      })

      return NextResponse.json(
        {
          ok: false,
          error: 'TOKEN_UPSTREAM',
          status: err.status,
          requestId,
        },
        {
          status: 502,
          headers: withRequestIdHeaders(undefined, requestId),
        }
      )
    }

    if (err instanceof IolTokenFormatError) {
      logServerError('api.token.POST', err, {
        requestId,
        route: '/api/token',
        errorCode: 'TOKEN_FORMAT',
      })

      return NextResponse.json(
        {
          ok: false,
          error: 'TOKEN_FORMAT',
          details: getSafeErrorDetails(err),
          requestId,
        },
        {
          status: 502,
          headers: withRequestIdHeaders(undefined, requestId),
        }
      )
    }

    logServerError('api.token.POST', err, {
      requestId,
      route: '/api/token',
      errorCode: 'TOKEN_ERROR',
    })

    return NextResponse.json(
      {
        ok: false,
        error: 'TOKEN_ERROR',
        details: getSafeErrorDetails(err),
        requestId,
      },
      {
        status: 500,
        headers: withRequestIdHeaders(undefined, requestId),
      }
    )
  }
}
