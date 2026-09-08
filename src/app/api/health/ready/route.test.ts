import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = { ...process.env }
const REDIS_URL = 'https://redis.internal.example.test'
const REDIS_TOKEN = 'redis-secret-token'
const LIVE_CONFIG = {
  API_URL: 'https://api.example.test',
  API_USERNAME: 'user',
  API_PASSWORD: 'password',
  PANEL_LIDER_ENDPOINT: 'panel/lider',
  PANEL_GENERAL_ENDPOINT: 'panel/general',
  PANEL_CEDEARS_ENDPOINT: 'panel/cedears',
} as const

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function setEnv(values: Record<string, string | undefined>) {
  process.env = { ...OLD_ENV }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

async function loadRoute(values: Record<string, string | undefined> = {}) {
  vi.resetModules()
  setEnv({
    NODE_ENV: 'test',
    RATE_LIMIT_REDIS_REST_TOKEN: REDIS_TOKEN,
    RATE_LIMIT_REDIS_REST_URL: REDIS_URL,
    RATE_LIMIT_STORE: 'redis-rest',
    ...values,
  })
  vi.doMock('server-only', () => ({}))
  return import('./route')
}

function request() {
  return new NextRequest('http://localhost/api/health/ready')
}

describe('/api/health/ready route', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = { ...OLD_ENV }
  })

  it('returns 200 after a successful, read-only Redis PING', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ result: 'PONG' }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.dependencies.rateLimitStore).toMatchObject({
      required: true,
      status: 'available',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual(['PING'])
    expect(String(init?.body)).not.toContain('EVAL')
    expect(String(init?.body)).not.toContain('INCR')
    expect(String(init?.body)).not.toContain('ratelimit:')
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false)
    expect(Number.isNaN(Date.parse(body.servedAt))).toBe(false)
  })

  it('returns 503 when Redis rejects the network request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not-ready',
      dependencies: {
        rateLimitStore: { required: true, status: 'unavailable' },
      },
    })
  })

  it('returns 503 for a non-successful Redis HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private redis body', { status: 500 }))
    )
    const { GET } = await loadRoute()

    const response = await GET(request())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(serialized).toContain('"status":"unavailable"')
    expect(serialized).not.toContain('private redis body')
  })

  it.each([
    Response.json({ result: 'unexpected' }),
    new Response('{not-json'),
    Response.json({ error: 'private redis error' }),
  ])('returns 503 for an invalid Redis response', async (redisResponse) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redisResponse))
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.dependencies.rateLimitStore.status).toBe('invalid-response')
    expect(JSON.stringify(body)).not.toContain('private redis error')
  })

  it('returns 503 within the configured timeout when Redis never responds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
      )
    )
    const { GET } = await loadRoute({ RATE_LIMIT_REDIS_TIMEOUT_MS: '2000' })

    const responsePromise = GET(request())
    const assertion = expect(responsePromise).resolves.toMatchObject({ status: 503 })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await assertion

    const response = await responsePromise
    expect((await response.json()).dependencies.rateLimitStore.status).toBe(
      'timeout'
    )
  })

  it('returns 200 without Redis when the configured store is not required', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_REDIS_REST_URL: undefined,
      RATE_LIMIT_STORE: 'memory',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ready',
      dependencies: {
        rateLimitStore: {
          checkedAt: null,
          latencyMs: null,
          required: false,
          status: 'not-required',
        },
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503 when live configuration is missing API_PASSWORD', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      ...LIVE_CONFIG,
      MARKET_DATA_SOURCE: 'live',
      API_PASSWORD: undefined,
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_REDIS_REST_URL: undefined,
      RATE_LIMIT_STORE: 'memory',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not-ready',
      dependencies: {
        config: {
          status: 'invalid-configuration',
          marketDataSource: 'live',
          missingLiveConfig: ['API_PASSWORD'],
        },
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503 when live configuration contains an invalid API URL', async () => {
    const { GET } = await loadRoute({
      ...LIVE_CONFIG,
      MARKET_DATA_SOURCE: 'live',
      API_URL: 'https://api.example.test?token=invalid',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ result: 'PONG' })))

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.dependencies.config).toMatchObject({
      status: 'invalid-configuration',
      marketDataSource: 'live',
      invalidLiveConfig: ['API_URL'],
    })
  })

  it('returns 200 for valid demo configuration', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'demo',
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_REDIS_REST_URL: undefined,
      RATE_LIMIT_STORE: 'memory',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.dependencies.config).toMatchObject({
      status: 'available',
      marketDataSource: 'demo',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 200 for valid live configuration', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      ...LIVE_CONFIG,
      MARKET_DATA_SOURCE: 'live',
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_REDIS_REST_URL: undefined,
      RATE_LIMIT_STORE: 'memory',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.dependencies.config).toMatchObject({
      status: 'available',
      marketDataSource: 'live',
      invalidLiveConfig: [],
      missingLiveConfig: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not report ready when live config and required Redis are both invalid', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      ...LIVE_CONFIG,
      MARKET_DATA_SOURCE: 'live',
      API_PASSWORD: undefined,
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_STORE: 'redis-rest',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not-ready',
      dependencies: {
        config: { status: 'invalid-configuration' },
        rateLimitStore: { required: true, status: 'not-configured' },
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503 when redis-rest is required but incomplete', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_STORE: 'redis-rest',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.dependencies.rateLimitStore).toEqual({
      checkedAt: null,
      latencyMs: null,
      required: true,
      status: 'not-configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503 without a network call for an insecure required Redis URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      NODE_ENV: 'production',
      RATE_LIMIT_REDIS_REST_URL:
        'http://user:private-password@redis.example.test',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.dependencies.rateLimitStore.status).toBe(
      'invalid-configuration'
    )
    expect(JSON.stringify(body)).not.toContain('private-password')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { RATE_LIMIT_STORE: 'unknown' },
    {
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_STORE: 'auto',
    },
    { RATE_LIMIT_REDIS_REST_URL: 'not-a-url' },
  ])('returns 503 for invalid required configuration', async (env) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute(env)

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.dependencies.rateLimitStore.status).toBe(
      'invalid-configuration'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent probes and caches the result for five seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    const firstProbe = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstProbe.promise)
      .mockResolvedValue(Response.json({ result: 'PONG' }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute()

    const first = GET(request())
    const concurrent = GET(request())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    firstProbe.resolve(Response.json({ result: 'PONG' }))
    const [firstResponse, concurrentResponse] = await Promise.all([
      first,
      concurrent,
    ])
    const firstBody = await firstResponse.json()
    const concurrentBody = await concurrentResponse.json()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(concurrentBody.checkedAt).toBe(firstBody.checkedAt)

    await vi.advanceTimersByTimeAsync(4_999)
    const cachedResponse = await GET(request())
    const cachedBody = await cachedResponse.json()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cachedBody.checkedAt).toBe(firstBody.checkedAt)
    expect(Date.parse(cachedBody.servedAt)).toBeGreaterThan(
      Date.parse(cachedBody.checkedAt)
    )

    await vi.advanceTimersByTimeAsync(1)
    await GET(request())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed result beyond the five-second window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(Response.json({ result: 'PONG' }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute()

    expect((await GET(request())).status).toBe(503)
    await vi.advanceTimersByTimeAsync(4_999)
    expect((await GET(request())).status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect((await GET(request())).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not expose Redis URL, token, command response, or failure details', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new Error(`${REDIS_URL} ${REDIS_TOKEN} private-response-body`)
        )
    )
    const { GET } = await loadRoute()

    const response = await GET(request())
    const output = JSON.stringify({
      body: await response.json(),
      errorLogs: consoleError.mock.calls,
      warnLogs: consoleWarn.mock.calls,
    })

    expect(response.status).toBe(503)
    expect(output).not.toContain(REDIS_URL)
    expect(output).not.toContain(REDIS_TOKEN)
    expect(output).not.toContain('private-response-body')
    expect(output).not.toContain('PING')
  })
})
