import 'server-only'

import type { NextRequest } from 'next/server'
import { ENV } from './env'

type LogContext = Record<string, unknown>
type LogLevel = 'info' | 'warn' | 'error'
type MetricTags = Record<string, string | number | boolean>
type MetricCounterEntry = {
  name: string
  tags: Record<string, string>
  value: number
}
type MetricTimingEntry = {
  count: number
  last: number
  max: number
  min: number
  name: string
  sum: number
  tags: Record<string, string>
}

const REQUEST_ID_HEADER = 'X-Request-Id'
const MAX_REQUEST_ID_LENGTH = 128
const MAX_LOG_STRING_LENGTH = 512
const APP_STARTED_AT = Date.now()
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi
const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|access_token|refresh_token|password|secret|api[_-]?key|client_id|client_secret|account(?:_id|id|number)?)$/i
const AUTHORIZATION_ASSIGNMENT_PATTERN =
  /(["']?authorization["']?\s*[:=]\s*)("?Bearer\s+[A-Za-z0-9\-._~+/]+=*"?)/gi
const COOKIE_ASSIGNMENT_PATTERN =
  /(["']?(cookie|set-cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\r\n]+)/gi
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(["']?(x-api-key|access_token|refresh_token|password|secret|api[_-]?key|client_id|client_secret|account(?:_id|id|number)?)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi
const X_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/

const UPSTREAM_ERROR_FIELDS = [
  'error',
  'error_description',
  'message',
  'detail',
  'code',
  'type',
] as const
const metricCounters = new Map<string, MetricCounterEntry>()
const metricTimings = new Map<string, MetricTimingEntry>()

function truncateString(value: string, limit = MAX_LOG_STRING_LENGTH): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

function getConfiguredSecrets(): string[] {
  return [
    process.env.API_URL,
    process.env.API_USERNAME,
    process.env.API_PASSWORD,
    process.env.LOCAL_DEBUG_TOKEN,
    process.env.RATE_LIMIT_REDIS_REST_URL,
    process.env.RATE_LIMIT_REDIS_REST_TOKEN,
  ].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
}

export function sanitizeLogString(value: string): string {
  let redacted = value

  for (const secret of getConfiguredSecrets()) {
    redacted = redacted.split(secret).join('[redacted]')
  }

  redacted = redacted
    .replace(
      AUTHORIZATION_ASSIGNMENT_PATTERN,
      (_match, prefix: string) => `${prefix}"Bearer [redacted]"`
    )
    .replace(
      COOKIE_ASSIGNMENT_PATTERN,
      (_match, prefix: string) => `${prefix}"[redacted]"`
    )
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(JWT_PATTERN, '[redacted-jwt]')
    .replace(
      SENSITIVE_ASSIGNMENT_PATTERN,
      (_match, prefix: string) => `${prefix}"[redacted]"`
    )

  return truncateString(redacted)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeLogString(value)
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Error) {
    return sanitizeErrorInfo(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item))
  }

  if (value instanceof Headers) {
    return sanitizeHeaders(value)
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? '[redacted]'
          : sanitizeLogValue(entryValue),
      ])
    )
  }

  return sanitizeLogString(String(value))
}

function sanitizeHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeLogString(value),
    ])
  )
}

function cleanContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, sanitizeLogValue(value)])
  )
}

function isProductionLikeEnvironment() {
  return ENV.NODE_ENV === 'production'
}

function sanitizeErrorInfo(error: unknown) {
  if (error instanceof Error) {
    const errorInfo = {
      name: error.name,
      message: sanitizeLogString(error.message),
    } as Record<string, unknown>

    const typedError = error as Error & {
      category?: unknown
      requestId?: unknown
      status?: unknown
      statusText?: unknown
      upstreamPath?: unknown
      upstreamSummary?: unknown
    }

    if (typedError.category) {
      errorInfo.category = sanitizeLogValue(typedError.category)
    }

    if (typedError.requestId) {
      errorInfo.requestId = sanitizeLogValue(typedError.requestId)
    }

    if (typedError.status !== undefined) {
      errorInfo.status = sanitizeLogValue(typedError.status)
    }

    if (typedError.statusText) {
      errorInfo.statusText = sanitizeLogValue(typedError.statusText)
    }

    if (typedError.upstreamPath) {
      errorInfo.upstreamPath = sanitizeLogValue(typedError.upstreamPath)
    }

    if (typedError.upstreamSummary) {
      errorInfo.upstreamSummary = sanitizeLogValue(typedError.upstreamSummary)
    }

    if (!isProductionLikeEnvironment() && error.stack) {
      errorInfo.stack = sanitizeLogString(error.stack)
    }

    return errorInfo
  }

  return {
    message: sanitizeLogString(String(error ?? 'unknown')),
  }
}

function writeLog(level: LogLevel, event: string, payload: LogContext) {
  const printer =
    level === 'info' ? console.info : level === 'warn' ? console.warn : console.error

  printer(`[${event}]`, {
    level,
    timestamp: new Date().toISOString(),
    ...payload,
  })
}

function normalizeMetricTags(tags: MetricTags = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags)
      .filter(([, value]) => value !== undefined)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, value]) => [key, String(value)])
  )
}

function getMetricKey(name: string, tags: Record<string, string>) {
  return `${name}:${JSON.stringify(tags)}`
}

export function logServerInfo(event: string, context: LogContext = {}) {
  writeLog('info', event, cleanContext(context))
}

export function logServerWarn(event: string, context: LogContext = {}) {
  writeLog('warn', event, cleanContext(context))
}

export function logServerError(
  event: string,
  error: unknown,
  context: LogContext = {}
) {
  writeLog('error', event, {
    ...cleanContext(context),
    error: sanitizeErrorInfo(error),
  })
}

export function incrementMetricCounter(
  name: string,
  value = 1,
  tags: MetricTags = {}
) {
  if (!Number.isFinite(value) || value === 0) {
    return
  }

  const normalizedTags = normalizeMetricTags(tags)
  const key = getMetricKey(name, normalizedTags)
  const current = metricCounters.get(key)

  if (current) {
    current.value += value
    return
  }

  metricCounters.set(key, {
    name,
    tags: normalizedTags,
    value,
  })
}

export function recordMetricDuration(
  name: string,
  durationMs: number,
  tags: MetricTags = {}
) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return
  }

  const normalizedTags = normalizeMetricTags(tags)
  const key = getMetricKey(name, normalizedTags)
  const current = metricTimings.get(key)

  if (current) {
    current.count += 1
    current.sum += durationMs
    current.min = Math.min(current.min, durationMs)
    current.max = Math.max(current.max, durationMs)
    current.last = durationMs
    return
  }

  metricTimings.set(key, {
    count: 1,
    last: durationMs,
    max: durationMs,
    min: durationMs,
    name,
    sum: durationMs,
    tags: normalizedTags,
  })
}

export function recordApiRequest({
  endpoint,
  method,
  outcome,
  source,
  startedAt,
  status,
}: {
  endpoint: string
  method: string
  outcome: string
  source: string
  startedAt?: number
  status: number
}) {
  incrementMetricCounter('api.request.total', 1, {
    endpoint,
    method,
    outcome,
    source,
    status,
  })

  if (startedAt !== undefined) {
    recordMetricDuration('api.request.duration_ms', Date.now() - startedAt, {
      endpoint,
      method,
      status,
    })
  }
}

export function getObservabilitySnapshot() {
  const counters = [...metricCounters.values()]
    .map((entry) => ({
      name: entry.name,
      tags: entry.tags,
      value: entry.value,
    }))
    .sort((first, second) =>
      `${first.name}:${JSON.stringify(first.tags)}`.localeCompare(
        `${second.name}:${JSON.stringify(second.tags)}`
      )
    )
  const timings = [...metricTimings.values()]
    .map((entry) => ({
      avg: entry.count > 0 ? Number((entry.sum / entry.count).toFixed(2)) : 0,
      count: entry.count,
      last: Number(entry.last.toFixed(2)),
      max: Number(entry.max.toFixed(2)),
      min: Number(entry.min.toFixed(2)),
      name: entry.name,
      sum: Number(entry.sum.toFixed(2)),
      tags: entry.tags,
    }))
    .sort((first, second) =>
      `${first.name}:${JSON.stringify(first.tags)}`.localeCompare(
        `${second.name}:${JSON.stringify(second.tags)}`
      )
    )

  return {
    counters,
    generatedAt: new Date().toISOString(),
    processLocal: true,
    timings,
    uptimeMs: Date.now() - APP_STARTED_AT,
  }
}

export function getApproximateUptimeMs() {
  return Date.now() - APP_STARTED_AT
}

export function clearObservabilityStateForTests() {
  metricCounters.clear()
  metricTimings.clear()
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function isValidRequestId(value: string | null): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    X_REQUEST_ID_PATTERN.test(value)
  )
}

export function getRequestId(req: NextRequest): string {
  const inbound = req.headers.get('x-request-id')
  return isValidRequestId(inbound) ? inbound : generateRequestId()
}

export function withRequestIdHeaders(
  headersInit: HeadersInit | undefined,
  requestId: string
): Headers {
  const headers = new Headers(headersInit)
  headers.set(REQUEST_ID_HEADER, requestId)
  return headers
}

export function getSafeErrorDetails(error: unknown): string | undefined {
  if (error instanceof Error) {
    return sanitizeLogString(error.message)
  }

  if (error === null || error === undefined) {
    return undefined
  }

  return sanitizeLogString(String(error))
}

export function extractUpstreamErrorSummary(text: string | null): unknown {
  if (!text) {
    return undefined
  }

  const trimmed = text.trim()

  if (!trimmed) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown

    if (isPlainObject(parsed)) {
      const summary = Object.fromEntries(
        UPSTREAM_ERROR_FIELDS.flatMap((field) => {
          const value = parsed[field]

          return value === undefined ? [] : [[field, sanitizeLogValue(value)]]
        })
      )

      if (Object.keys(summary).length > 0) {
        return summary
      }
    }
  } catch {
    // Fall back to a sanitized string summary.
  }

  return sanitizeLogString(trimmed)
}

export const observabilityTestExports = {
  clearObservabilityStateForTests,
  getObservabilitySnapshot,
  sanitizeLogValue,
  sanitizeHeaders,
}
