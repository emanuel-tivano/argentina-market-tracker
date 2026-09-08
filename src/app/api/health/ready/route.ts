import 'server-only'

import { type NextRequest } from 'next/server'
import { jsonResponse } from '@/lib/server/core/httpResponse'
import {
  getRequestId,
  incrementMetricCounter,
  withRequestIdHeaders,
} from '@/lib/server/core/observability'
import { getRateLimitStoreReadiness } from '@/lib/server/core/rateLimit'
import { getRuntimeEnvSummary } from '@/lib/server/core/env'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req)
  const runtimeEnv = getRuntimeEnvSummary()
  const rateLimitStore = await getRateLimitStoreReadiness()
  const servedAt = new Date().toISOString()
  const configReady =
    runtimeEnv.marketDataSource !== 'invalid' &&
    (runtimeEnv.marketDataSource !== 'live' ||
      (runtimeEnv.missingLiveConfig.length === 0 &&
        runtimeEnv.invalidLiveConfig.length === 0))
  const rateLimitStoreReady =
    !rateLimitStore.required || rateLimitStore.status === 'available'
  const isReady = configReady && rateLimitStoreReady
  const statusCode = isReady ? 200 : 503

  incrementMetricCounter('api.request.total', 1, {
    endpoint: '/api/health/ready',
    method: 'GET',
    outcome: isReady ? 'success' : 'not-ready',
    status: statusCode,
  })

  return jsonResponse(
    {
      checkedAt: rateLimitStore.checkedAt ?? servedAt,
      dependencies: {
        config: {
          status: configReady ? 'available' : 'invalid-configuration',
          marketDataSource: runtimeEnv.marketDataSource,
          missingLiveConfig: runtimeEnv.missingLiveConfig,
          invalidLiveConfig: runtimeEnv.invalidLiveConfig,
        },
        rateLimitStore,
      },
      servedAt,
      status: isReady ? 'ready' : 'not-ready',
    },
    {
      headers: withRequestIdHeaders(undefined, requestId),
      status: statusCode,
    },
    requestId
  )
}
