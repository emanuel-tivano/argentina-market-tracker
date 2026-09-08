import 'server-only'

import { isIP } from 'node:net'
import type { NextRequest } from 'next/server'
import { ENV } from './env'
import { incrementMetricCounter, logServerWarn } from './observability'

const RATE_LIMIT_HEADER_LIMIT = 'X-RateLimit-Limit'
const RATE_LIMIT_HEADER_REMAINING = 'X-RateLimit-Remaining'
const RATE_LIMIT_HEADER_RESET = 'X-RateLimit-Reset'
const RATE_LIMIT_NAMESPACE_PREFIX = 'ratelimit'
const REDIS_KEY_TTL_MULTIPLIER = 2
const RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC = 5
const RATE_LIMIT_READINESS_CACHE_TTL_MS = 5_000
const REDIS_FIXED_WINDOW_INCREMENT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`.trim()

type ProxyTrustMode = 'none' | 'vercel'
type RateLimitStoreMode = 'memory' | 'redis-rest'
type ConfiguredRateLimitStoreMode = 'auto' | RateLimitStoreMode
type RateLimitRuntimeReason =
  | 'distributed-store-unavailable'
  | 'memory-store-fallback'
  | 'shared-global-client-fallback'
type RateLimitFailureCode =
  | 'RATE_LIMIT_STORE_CONFIG_INVALID'
  | 'RATE_LIMIT_STORE_UNAVAILABLE'

type ResolvedStoreConfig =
  | { mode: 'memory' }
  | {
      mode: 'redis-rest'
      url: string
      token: string
    }

type ClientKeySource =
  | 'trusted-proxy-ip'
  | 'local-loopback'
  | 'global-fallback'

export type RateLimitIdentity = {
  key: string
  source: ClientKeySource
}

type RateLimitWindowState = {
  count: number
}

type MemoryRateLimitEntry = {
  count: number
  expiresAt: number
}

export type MaybePromise<T> = Promise<T> | T

export type RateLimitPolicy = {
  limit: number
  maxKeys?: number
  namespace: string
  windowMs: number
}

export type RateLimitCheckResult = {
  clientKey: string
  clientKeySource: ClientKeySource
  headers: Record<string, string>
  limit: number
  ok: boolean
  remaining: number
  resetAt: number
  retryAfterSec: number
  storeMode: RateLimitStoreMode
}

export type SafeRateLimitCheckResult =
  | {
      ok: true
      rateLimit: RateLimitCheckResult
    }
  | {
      error: 'RATE_LIMIT_UNAVAILABLE'
      ok: false
      retryAfterSec: number
      status: 503
    }

export type RateLimitStore = {
  readonly mode: RateLimitStoreMode
  incrementFixedWindow(
    key: string,
    options: {
      maxKeys?: number
      now: number
      ttlMs: number
    }
  ): MaybePromise<RateLimitWindowState>
  reset(): void
}

type UpstashCommandResult<T> = {
  error?: string
  result?: T
}

type RedisRestFailureReason =
  | 'timeout'
  | 'network-error'
  | 'http-error'
  | 'invalid-response'

class RedisRestRateLimitError extends Error {
  constructor(
    message: string,
    public readonly reason: RedisRestFailureReason
  ) {
    super(message)
    this.name = 'RedisRestRateLimitError'
  }
}

let storeSingleton: RateLimitStore | null = null
let readinessProbeCache: {
  expiresAt: number
  result: RateLimitStoreReadiness
} | null = null
let readinessProbeInFlight: Promise<RateLimitStoreReadiness> | null = null
const warnedMessages = new Set<string>()

export type RateLimitStoreReadinessStatus =
  | 'available'
  | 'unavailable'
  | 'timeout'
  | 'invalid-response'
  | 'not-configured'
  | 'invalid-configuration'
  | 'not-required'

export type RateLimitStoreReadiness = {
  checkedAt: string | null
  latencyMs: number | null
  required: boolean
  status: RateLimitStoreReadinessStatus
}

function warnOnce(message: string) {
  if (warnedMessages.has(message)) {
    return
  }

  warnedMessages.add(message)
  console.warn(message)
}

function isProductionLikeEnvironment() {
  return ENV.NODE_ENV === 'production'
}

function getMarketDataSourceSafe() {
  try {
    return ENV.MARKET_DATA_SOURCE
  } catch {
    return 'invalid'
  }
}

function shouldEnforceDistributedRateLimitHealth() {
  return (
    isProductionLikeEnvironment() || getMarketDataSourceSafe() === 'live'
  )
}

function getProxyTrustMode(): ProxyTrustMode {
  const configured = process.env.RATE_LIMIT_TRUSTED_PROXY

  if (configured === 'none' || configured === 'vercel') {
    return configured
  }

  if (isProductionLikeEnvironment() && process.env.VERCEL === '1') {
    return 'vercel'
  }

  return 'none'
}

function getProxyTrustModeSafe(): ProxyTrustMode | 'invalid' {
  try {
    return getProxyTrustMode()
  } catch {
    return 'invalid'
  }
}

function getConfiguredStoreMode(): ConfiguredRateLimitStoreMode {
  const configuredMode = process.env.RATE_LIMIT_STORE?.trim()

  if (!configuredMode || configuredMode === 'auto') {
    return 'auto'
  }

  if (configuredMode === 'memory' || configuredMode === 'redis-rest') {
    return configuredMode
  }

  throw new Error(
    'RATE_LIMIT_STORE must be one of auto, memory, redis-rest'
  )
}

function getConfiguredStoreModeSafe():
  | ConfiguredRateLimitStoreMode
  | 'invalid' {
  try {
    return getConfiguredStoreMode()
  } catch {
    return 'invalid'
  }
}

function getStoreConfig(): ResolvedStoreConfig {
  const configuredMode = process.env.RATE_LIMIT_STORE?.trim()
  const rawRedisUrl = process.env.RATE_LIMIT_REDIS_REST_URL?.trim()
  const redisToken = process.env.RATE_LIMIT_REDIS_REST_TOKEN?.trim()

  if (configuredMode === 'memory') {
    return { mode: 'memory' }
  }

  if (configuredMode === 'redis-rest') {
    if (!rawRedisUrl || !redisToken) {
      throw new Error(
        'RATE_LIMIT_STORE=redis-rest requires RATE_LIMIT_REDIS_REST_URL and RATE_LIMIT_REDIS_REST_TOKEN'
      )
    }

    return {
      mode: 'redis-rest',
      url: ENV.RATE_LIMIT_REDIS_REST_URL,
      token: redisToken,
    }
  }

  if (configuredMode && configuredMode !== 'auto') {
    throw new Error(
      'RATE_LIMIT_STORE must be one of auto, memory, redis-rest'
    )
  }

  if (rawRedisUrl && redisToken) {
    return {
      mode: 'redis-rest',
      url: ENV.RATE_LIMIT_REDIS_REST_URL,
      token: redisToken,
    }
  }

  if (isProductionLikeEnvironment()) {
    warnOnce(
      '[rate-limit.config] Production is running without distributed rate-limit storage. Falling back to process-local memory buckets.'
    )
  }

  return { mode: 'memory' }
}

function normalizeHeaderIp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const candidate = value.split(',')[0]?.trim() ?? ''

  if (!candidate) {
    return null
  }

  return isIP(candidate) ? candidate : null
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  )
}

export function resolveRateLimitIdentity(
  headers: Pick<Headers, 'get'>,
  hostname = ''
): RateLimitIdentity {
  const proxyTrustMode = getProxyTrustMode()

  if (proxyTrustMode === 'vercel') {
    const trustedIp =
      normalizeHeaderIp(headers.get('x-forwarded-for')) ??
      normalizeHeaderIp(headers.get('x-real-ip'))

    if (trustedIp) {
      return {
        key: `ip:${trustedIp}`,
        source: 'trusted-proxy-ip',
      }
    }

    warnOnce(
      '[rate-limit.identity] Trusted proxy mode is enabled but no valid forwarded client IP was found. Falling back to a shared global bucket.'
    )
  }

  if (!isProductionLikeEnvironment() && isLoopbackHostname(hostname)) {
    return {
      key: `loopback:${hostname}`,
      source: 'local-loopback',
    }
  }

  if (isProductionLikeEnvironment()) {
    warnOnce(
      '[rate-limit.identity] No trusted client IP source is configured. Falling back to a shared global bucket to avoid trusting spoofable headers.'
    )
  }

  return {
    key: 'global',
    source: 'global-fallback',
  }
}

function resolveClientKey(req: NextRequest): RateLimitIdentity {
  return resolveRateLimitIdentity(req.headers, req.nextUrl.hostname)
}

function createMemoryRateLimitStore(): RateLimitStore {
  const entries = new Map<string, MemoryRateLimitEntry>()

  function prune(now: number, maxKeys?: number) {
    for (const [key, entry] of entries) {
      if (now >= entry.expiresAt) {
        entries.delete(key)
      }
    }

    if (!maxKeys || entries.size <= maxKeys) {
      return
    }

    const entriesByExpiry = [...entries.entries()].sort(
      ([, first], [, second]) => first.expiresAt - second.expiresAt
    )

    for (const [key] of entriesByExpiry.slice(0, entries.size - maxKeys)) {
      entries.delete(key)
    }
  }

  return {
    mode: 'memory',
    async incrementFixedWindow(key, options) {
      prune(options.now, options.maxKeys)

      const current = entries.get(key)

      if (!current || options.now >= current.expiresAt) {
        entries.set(key, {
          count: 1,
          expiresAt: options.now + options.ttlMs,
        })

        return { count: 1 }
      }

      current.count += 1
      return { count: current.count }
    },
    reset() {
      entries.clear()
    },
  }
}

async function runRedisRestCommand<T>(
  url: string,
  token: string,
  command: (string | number)[]
): Promise<T> {
  const signal = AbortSignal.timeout(ENV.RATE_LIMIT_REDIS_TIMEOUT_MS)
  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
      redirect: 'error',
      signal,
    })
  } catch (error: unknown) {
    const isTimeout =
      signal.aborted ||
      (error instanceof DOMException && error.name === 'TimeoutError')

    throw new RedisRestRateLimitError(
      isTimeout
        ? 'Redis REST request timed out'
        : 'Redis REST network request failed',
      isTimeout ? 'timeout' : 'network-error'
    )
  }

  if (!response.ok) {
    throw new RedisRestRateLimitError(
      `Redis REST request failed with status ${response.status}`,
      'http-error'
    )
  }

  let json: UpstashCommandResult<T>

  try {
    json = (await response.json()) as UpstashCommandResult<T>
  } catch {
    throw new RedisRestRateLimitError(
      'Redis REST returned an invalid JSON response',
      'invalid-response'
    )
  }

  if (json.error) {
    throw new RedisRestRateLimitError(
      'Redis REST command returned an error',
      'invalid-response'
    )
  }

  return json.result as T
}

function getRedisReadinessConfig():
  | { required: false }
  | { required: true; status: 'invalid-configuration' | 'not-configured' }
  | { required: true; token: string; url: string } {
  const configuredMode = process.env.RATE_LIMIT_STORE?.trim() || 'auto'
  const rawUrl = process.env.RATE_LIMIT_REDIS_REST_URL?.trim() ?? ''
  const token = process.env.RATE_LIMIT_REDIS_REST_TOKEN?.trim() ?? ''

  if (configuredMode === 'memory') {
    return { required: false }
  }

  if (configuredMode !== 'auto' && configuredMode !== 'redis-rest') {
    return { required: true, status: 'invalid-configuration' }
  }

  if (configuredMode === 'auto' && !rawUrl && !token) {
    return { required: false }
  }

  if (!rawUrl || !token) {
    return {
      required: true,
      status:
        configuredMode === 'redis-rest'
          ? 'not-configured'
          : 'invalid-configuration',
    }
  }

  let url: string

  try {
    url = ENV.RATE_LIMIT_REDIS_REST_URL
  } catch {
    return { required: true, status: 'invalid-configuration' }
  }

  return { required: true, token, url }
}

function classifyReadinessFailure(
  error: unknown
): Extract<
  RateLimitStoreReadinessStatus,
  'invalid-response' | 'timeout' | 'unavailable'
> {
  if (!(error instanceof RedisRestRateLimitError)) {
    return 'unavailable'
  }

  if (error.reason === 'timeout') {
    return 'timeout'
  }

  if (error.reason === 'invalid-response') {
    return 'invalid-response'
  }

  return 'unavailable'
}

async function executeRedisReadinessProbe(config: {
  token: string
  url: string
}): Promise<RateLimitStoreReadiness> {
  const startedAt = Date.now()
  const checkedAt = new Date(startedAt).toISOString()

  try {
    const result = await runRedisRestCommand<unknown>(config.url, config.token, [
      'PING',
    ])

    if (result !== 'PONG') {
      throw new RedisRestRateLimitError(
        'Redis REST PING returned an invalid result',
        'invalid-response'
      )
    }

    return {
      checkedAt,
      latencyMs: Math.max(0, Date.now() - startedAt),
      required: true,
      status: 'available',
    }
  } catch (error: unknown) {
    return {
      checkedAt,
      latencyMs: Math.max(0, Date.now() - startedAt),
      required: true,
      status: classifyReadinessFailure(error),
    }
  }
}

export function getRateLimitStoreReadiness(): Promise<RateLimitStoreReadiness> {
  const config = getRedisReadinessConfig()

  if (!config.required) {
    return Promise.resolve({
      checkedAt: null,
      latencyMs: null,
      required: false,
      status: 'not-required',
    })
  }

  if ('status' in config) {
    return Promise.resolve({
      checkedAt: null,
      latencyMs: null,
      required: true,
      status: config.status,
    })
  }

  const now = Date.now()

  if (readinessProbeCache && now < readinessProbeCache.expiresAt) {
    return Promise.resolve(readinessProbeCache.result)
  }

  if (readinessProbeInFlight) {
    return readinessProbeInFlight
  }

  const probe = executeRedisReadinessProbe(config).then((result) => {
    readinessProbeCache = {
      expiresAt: Date.now() + RATE_LIMIT_READINESS_CACHE_TTL_MS,
      result,
    }
    return result
  })

  const probeWithCleanup = probe.finally(() => {
    if (readinessProbeInFlight === probeWithCleanup) {
      readinessProbeInFlight = null
    }
  })
  readinessProbeInFlight = probeWithCleanup

  return probeWithCleanup
}

function createRedisRestRateLimitStore(config: {
  token: string
  url: string
}): RateLimitStore {
  return {
    mode: 'redis-rest',
    async incrementFixedWindow(key, options) {
      const count = Number(
        await runRedisRestCommand<number | string>(config.url, config.token, [
          'EVAL',
          REDIS_FIXED_WINDOW_INCREMENT_SCRIPT,
          1,
          key,
          options.ttlMs,
        ])
      )

      if (!Number.isFinite(count)) {
        throw new RedisRestRateLimitError(
          'Redis REST EVAL returned an invalid result',
          'invalid-response'
        )
      }

      return { count }
    },
    reset() {},
  }
}

function getRateLimitStore(): RateLimitStore {
  if (storeSingleton) {
    return storeSingleton
  }

  const config = getStoreConfig()

  storeSingleton =
    config.mode === 'memory'
      ? createMemoryRateLimitStore()
      : createRedisRestRateLimitStore(config)

  return storeSingleton
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return value instanceof Promise
}

function createHeaders(
  limit: number,
  remaining: number,
  resetAt: number
): Record<string, string> {
  return {
    [RATE_LIMIT_HEADER_LIMIT]: String(limit),
    [RATE_LIMIT_HEADER_REMAINING]: String(Math.max(0, remaining)),
    [RATE_LIMIT_HEADER_RESET]: String(Math.ceil(resetAt / 1000)),
  }
}

export function checkRateLimit(
  req: NextRequest,
  policy: RateLimitPolicy,
  scope: string
): MaybePromise<RateLimitCheckResult> {
  return checkRateLimitWithIdentity(resolveClientKey(req), policy, scope)
}

function checkRateLimitWithIdentity(
  identity: RateLimitIdentity,
  policy: RateLimitPolicy,
  scope: string
): MaybePromise<RateLimitCheckResult> {
  const now = Date.now()
  const windowId = Math.floor(now / policy.windowMs)
  const resetAt = (windowId + 1) * policy.windowMs
  const { key: clientKey, source: clientKeySource } = identity
  const bucketKey = [
    RATE_LIMIT_NAMESPACE_PREFIX,
    policy.namespace,
    scope,
    clientKey,
    String(windowId),
  ].join(':')
  const ttlMs = policy.windowMs * REDIS_KEY_TTL_MULTIPLIER
  const store = getRateLimitStore()
  const state = store.incrementFixedWindow(bucketKey, {
    now,
    ttlMs,
    maxKeys: policy.maxKeys,
  })

  function finalizeState(nextState: RateLimitWindowState): RateLimitCheckResult {
    const remaining = Math.max(0, policy.limit - nextState.count)
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000))
    const ok = nextState.count <= policy.limit

    incrementMetricCounter('rate_limit.check.total', 1, {
      clientKeySource,
      namespace: policy.namespace,
      outcome: ok ? 'allowed' : 'blocked',
      scope,
      storeMode: store.mode,
    })

    return {
      clientKey,
      clientKeySource,
      headers: createHeaders(policy.limit, remaining, resetAt),
      limit: policy.limit,
      ok,
      remaining,
      resetAt,
      retryAfterSec,
      storeMode: store.mode,
    }
  }

  return isPromiseLike(state) ? state.then(finalizeState) : finalizeState(state)
}

export function checkRateLimitForIdentity(
  identity: RateLimitIdentity,
  policy: RateLimitPolicy,
  scope: string
): MaybePromise<RateLimitCheckResult> {
  return checkRateLimitWithIdentity(identity, policy, scope)
}

function classifyRateLimitFailure(error: unknown): RateLimitFailureCode {
  if (
    error instanceof Error &&
    (error.message.includes('RATE_LIMIT_STORE=') ||
      error.message.includes('RATE_LIMIT_REDIS_REST_URL'))
  ) {
    return 'RATE_LIMIT_STORE_CONFIG_INVALID'
  }

  return 'RATE_LIMIT_STORE_UNAVAILABLE'
}

export async function safeCheckRateLimit(
  check: () => MaybePromise<RateLimitCheckResult>,
  context: {
    requestId?: string
    route: string
  }
): Promise<SafeRateLimitCheckResult> {
  try {
    const maybeResult = check()
    const rateLimit =
      maybeResult instanceof Promise ? await maybeResult : maybeResult

    return {
      ok: true,
      rateLimit,
    }
  } catch (error: unknown) {
    const configuredStore = getConfiguredStoreModeSafe()
    const store =
      configuredStore === 'memory' || configuredStore === 'redis-rest'
        ? configuredStore
        : 'auto'
    const failureCode = classifyRateLimitFailure(error)
    const failureReason =
      error instanceof RedisRestRateLimitError ? error.reason : 'unknown'

    logServerWarn('rate_limit.unavailable', {
      requestId: context.requestId,
      route: context.route,
      store,
      failureCode,
      failureReason,
      error,
    })
    incrementMetricCounter('rate_limit.unavailable.total', 1, {
      failureCode,
      failureReason,
      route: context.route,
      store,
    })

    return {
      ok: false,
      error: 'RATE_LIMIT_UNAVAILABLE',
      retryAfterSec: RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC,
      status: 503,
    }
  }
}

export function getRetryAfterHeaders(result: RateLimitCheckResult) {
  return {
    ...result.headers,
    'Retry-After': String(result.retryAfterSec),
  }
}

export function clearRateLimitStateForTests() {
  storeSingleton?.reset()
  storeSingleton = null
  readinessProbeCache = null
  readinessProbeInFlight = null
  warnedMessages.clear()
}

export function getRateLimitRuntimeInfo() {
  const configuredStore = getConfiguredStoreModeSafe()
  const trustedProxy = getProxyTrustModeSafe()
  const degradedReasons: RateLimitRuntimeReason[] = []

  try {
    const store = getRateLimitStore()
    const strictHealthMode = shouldEnforceDistributedRateLimitHealth()

    if (strictHealthMode && store.mode === 'memory') {
      degradedReasons.push('memory-store-fallback')
    }

    if (strictHealthMode && trustedProxy === 'none') {
      degradedReasons.push('shared-global-client-fallback')
    }

    return {
      configuredStore,
      ok: degradedReasons.length === 0,
      reasons: degradedReasons,
      status: degradedReasons.length === 0 ? ('ok' as const) : ('degraded' as const),
      storeMode: store.mode,
      trustedProxy,
    }
  } catch (error: unknown) {
    return {
      configuredStore,
      error: classifyRateLimitFailure(error),
      ok: false as const,
      reasons: ['distributed-store-unavailable'] as const,
      status: 'degraded' as const,
      storeMode: 'unavailable',
      trustedProxy,
    }
  }
}

export const rateLimitTestExports = {
  createMemoryRateLimitStore,
  createRedisRestRateLimitStore,
  resolveClientKey,
}
