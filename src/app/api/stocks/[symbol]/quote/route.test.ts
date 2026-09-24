import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = { ...process.env }

class MockIolUpstreamHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
  }
}

function setRequiredEnv(overrides: Record<string, string> = {}) {
  process.env = {
    ...OLD_ENV,
    API_URL: 'https://api.example.test',
    TOKEN_ENDPOINT: 'token',
    API_USERNAME: 'user',
    API_PASSWORD: 'password',
    MARKET_DATA_SOURCE: 'live',
    RATE_LIMIT_STORE: 'memory',
    NODE_ENV: 'test',
    ...overrides,
  }
}

function request(
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1]
) {
  return new NextRequest(`http://localhost${path}`, init)
}

function context(symbol: string) {
  return { params: Promise.resolve({ symbol }) }
}

function quotePayload(overrides: Record<string, unknown> = {}) {
  return {
    simbolo: 'GGAL',
    mercado: 'bCBA',
    descripcionTitulo: 'Grupo Financiero Galicia',
    ultimoPrecio: 100,
    variacion: 1.5,
    apertura: 98,
    maximo: 101,
    minimo: 97,
    cierreAnterior: 98.5,
    volumenNominal: 12345,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

type QuoteRoute = typeof import('./route')
let loadedRoute: QuoteRoute | null = null

async function loadRoute(
  iolFetch: ReturnType<typeof vi.fn>,
  envOverrides: Record<string, string> = {}
) {
  vi.resetModules()
  setRequiredEnv(envOverrides)
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    iolFetch,
    IolUpstreamHttpError: MockIolUpstreamHttpError,
    isRecoverableIolUpstreamError: (
      error: unknown,
      options: { allowNotFound?: boolean } = {}
    ) => {
      if (error instanceof TypeError) return false
      if (error instanceof MockIolUpstreamHttpError) {
        return (
          (options.allowNotFound === true && error.status === 404) ||
          error.status === 429 ||
          error.status >= 500
        )
      }
      return error instanceof Error
    },
  }))

  loadedRoute = await import('./route')
  return loadedRoute
}

describe('/api/stocks/[symbol]/quote route', () => {
  beforeEach(() => {
    setRequiredEnv()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T15:00:00.000Z'))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    loadedRoute?.clearQuoteStateForTests()
    loadedRoute = null
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.resetModules()
    process.env = { ...OLD_ENV }
  })

  it('returns a normalized live quote and operational headers', async () => {
    const iolFetch = vi.fn().mockResolvedValue(quotePayload())
    const { GET } = await loadRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/GGAL/quote?market=bCBA'),
      context('GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Quote-Cache')).toBe('fresh')
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
    expect(response.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(body).toMatchObject({
      ok: true,
      cacheStatus: 'fresh',
      stale: false,
      staleUntil: '2026-07-14T15:02:00.000Z',
      source: 'live',
      market: 'bCBA',
      symbol: 'GGAL',
      fetchedAt: '2026-07-14T15:00:00.000Z',
      servedAt: '2026-07-14T15:00:00.000Z',
      data: {
        symbol: 'GGAL',
        price: 100,
        description: 'Grupo Financiero Galicia',
        volume: 12345,
      },
    })
    expect(iolFetch).toHaveBeenCalledWith(
      '/api/v2/bCBA/Titulos/GGAL/Cotizacion?mercado=bcba&simbolo=GGAL&model.simbolo=GGAL&model.mercado=bCBA&model.plazo=t1'
    )
  })

  it('rejects an invalid symbol before rate limiting or upstream access', async () => {
    const iolFetch = vi.fn()
    const { GET } = await loadRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/bad/quote'),
      context('bad symbol!')
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'INVALID_SYMBOL',
      requestId: expect.any(String),
    })
    expect(response.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(iolFetch).not.toHaveBeenCalled()
  })

  it('decodes, trims, and uppercases a valid symbol', async () => {
    const iolFetch = vi.fn().mockResolvedValue(quotePayload())
    const { GET } = await loadRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/%20ggal%20/quote'),
      context('%20ggal%20')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ symbol: 'GGAL' })
    expect(iolFetch).toHaveBeenCalledWith(
      '/api/v2/bCBA/Titulos/GGAL/Cotizacion?mercado=bcba&simbolo=GGAL&model.simbolo=GGAL&model.mercado=bCBA&model.plazo=t1'
    )
  })

  it('serves repeated requests from the fresh cache', async () => {
    const iolFetch = vi.fn().mockResolvedValue(quotePayload())
    const { GET } = await loadRoute(iolFetch)

    const first = await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    vi.setSystemTime(new Date('2026-07-14T15:00:05.000Z'))
    const second = await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))

    expect(first.headers.get('X-Quote-Cache')).toBe('fresh')
    expect(second.headers.get('X-Quote-Cache')).toBe('memory-cache')
    expect((await second.json()).servedAt).toBe('2026-07-14T15:00:05.000Z')
    expect(iolFetch).toHaveBeenCalledTimes(1)
  })

  it('returns 502 when the provider fails without stale data', async () => {
    const iolFetch = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const { GET } = await loadRoute(iolFetch)

    const response = await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'QUOTE_ERROR',
      requestId: expect.any(String),
    })
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
  })

  it('serves stale data when a refresh fails inside the stale window', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce(quotePayload())
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const { GET } = await loadRoute(iolFetch)

    const first = await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    vi.setSystemTime(new Date('2026-07-14T15:00:16.000Z'))
    const stale = await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    const staleBody = await stale.json()

    expect(first.status).toBe(200)
    expect(stale.status).toBe(200)
    expect(stale.headers.get('X-Quote-Cache')).toBe('stale')
    expect(staleBody).toMatchObject({
      cacheStatus: 'stale',
      stale: true,
      staleUntil: '2026-07-14T15:02:00.000Z',
      degradationReason: 'upstream-unavailable',
      fetchedAt: '2026-07-14T15:00:00.000Z',
      servedAt: '2026-07-14T15:00:16.000Z',
      symbol: 'GGAL',
    })
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })

  it('does not serve stale data after the two-minute stale window', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce(quotePayload())
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const { GET } = await loadRoute(iolFetch)

    await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    vi.setSystemTime(new Date('2026-07-14T15:02:00.001Z'))
    const response = await GET(
      request('/api/stocks/GGAL/quote'),
      context('GGAL')
    )

    expect(response.status).toBe(502)
    expect(response.headers.get('X-Quote-Cache')).toBeNull()
    expect(await response.json()).toMatchObject({ error: 'QUOTE_ERROR' })
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })

  it('rate limits the 121st request and returns rate limit headers', async () => {
    const iolFetch = vi.fn().mockResolvedValue(quotePayload())
    const { GET } = await loadRoute(iolFetch)
    let response!: Response

    for (let index = 0; index < 121; index += 1) {
      response = await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    }

    expect(response.status).toBe(429)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(response.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/)
    expect(response.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'RATE_LIMITED',
    })
    expect(iolFetch).toHaveBeenCalledTimes(1)
  })

  it('fails closed with 503 when Redis REST exceeds its timeout', async () => {
    vi.useRealTimers()
    const iolFetch = vi.fn()
    const redisFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: 1 }))
      .mockImplementationOnce(
        (_url: string, init: RequestInit = {}) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(init.signal?.reason),
              { once: true }
            )
          })
      )
    vi.stubGlobal('fetch', redisFetch)
    const { GET } = await loadRoute(iolFetch, {
      RATE_LIMIT_REDIS_TIMEOUT_MS: '2000',
      RATE_LIMIT_STORE: 'redis-rest',
      RATE_LIMIT_REDIS_REST_URL: 'https://redis.example.test',
      RATE_LIMIT_REDIS_REST_TOKEN: 'secret-token',
    })

    const response = await GET(
      request('/api/stocks/GGAL/quote'),
      context('GGAL')
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'RATE_LIMIT_UNAVAILABLE',
    })
    expect(redisFetch).toHaveBeenCalledTimes(2)
    expect(iolFetch).not.toHaveBeenCalled()
  }, 5_000)

  it('deduplicates concurrent requests for the same quote', async () => {
    const pending = deferred<ReturnType<typeof quotePayload>>()
    const iolFetch = vi.fn().mockReturnValue(pending.promise)
    const { GET } = await loadRoute(iolFetch)

    const first = GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    const second = GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    await vi.waitFor(() => expect(iolFetch).toHaveBeenCalledTimes(1))
    pending.resolve(quotePayload())

    const responses = await Promise.all([first, second])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(iolFetch).toHaveBeenCalledTimes(1)
    const { checkQuoteUpstreamBudget } = await import(
      '@/lib/server/quote/quoteRateLimit'
    )
    const probe = await checkQuoteUpstreamBudget({
      key: 'loopback:localhost',
      source: 'local-loopback',
    })
    expect(probe.remaining).toBe(118)
  })

  it('shares the real upstream budget between SSR and API without double application', async () => {
    const iolFetch = vi.fn((endpoint: string) =>
      Promise.resolve(
        endpoint.includes('/ALUA/')
          ? quotePayload({ simbolo: 'ALUA', descripcionTitulo: 'Aluar' })
          : quotePayload()
      )
    )
    const { GET } = await loadRoute(iolFetch)
    vi.doMock('next/headers', () => ({
      headers: vi.fn(async () => new Headers({ host: 'localhost' })),
    }))
    vi.doMock('next/navigation', () => ({
      notFound: vi.fn(() => {
        throw new Error('NEXT_NOT_FOUND')
      }),
    }))
    vi.doMock(
      '@/features/dashboard/stock-detail/StockDetailPageClient',
      () => ({ default: () => null })
    )
    const { default: StockPage } = await import(
      '@/app/stocks/[symbol]/page'
    )

    await StockPage({ params: Promise.resolve({ symbol: 'GGAL' }) })
    const apiResponse = await GET(
      request('/api/stocks/ALUA/quote'),
      context('ALUA')
    )

    expect(apiResponse.status).toBe(200)
    expect(apiResponse.headers.get('X-RateLimit-Remaining')).toBe('119')
    expect(apiResponse.headers.get('X-Quote-Cache')).toBe('fresh')
    expect(iolFetch).toHaveBeenCalledTimes(2)

    const { checkQuoteUpstreamBudget } = await import(
      '@/lib/server/quote/quoteRateLimit'
    )
    const probe = await checkQuoteUpstreamBudget({
      key: 'loopback:localhost',
      source: 'local-loopback',
    })
    expect(probe.remaining).toBe(117)
  })

  it('rejects an incomplete provider response', async () => {
    const iolFetch = vi.fn().mockResolvedValue({ simbolo: 'GGAL' })
    const { GET } = await loadRoute(iolFetch)

    const response = await GET(request('/api/stocks/GGAL/quote'), context('GGAL'))

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'QUOTE_ERROR',
    })
  })

  it('clears a rejected in-flight request so a later request can recover', async () => {
    const pending = deferred<ReturnType<typeof quotePayload>>()
    const iolFetch = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(quotePayload())
    const { GET } = await loadRoute(iolFetch)

    const first = GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    const second = GET(request('/api/stocks/GGAL/quote'), context('GGAL'))
    await vi.waitFor(() => expect(iolFetch).toHaveBeenCalledTimes(1))
    pending.reject(new Error('temporary provider error'))

    const failed = await Promise.all([first, second])
    expect(failed.map((response) => response.status)).toEqual([502, 502])

    const recovered = await GET(
      request('/api/stocks/GGAL/quote'),
      context('GGAL')
    )
    expect(recovered.status).toBe(200)
    expect(recovered.headers.get('X-Quote-Cache')).toBe('fresh')
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })

  it('isolates cache and in-flight work between different symbols', async () => {
    const iolFetch = vi.fn((endpoint: string) =>
      Promise.resolve(
        endpoint.includes('/ALUA/')
          ? quotePayload({ simbolo: 'ALUA', descripcionTitulo: 'Aluar' })
          : quotePayload()
      )
    )
    const { GET } = await loadRoute(iolFetch)

    const [ggal, alua] = await Promise.all([
      GET(request('/api/stocks/GGAL/quote'), context('GGAL')),
      GET(request('/api/stocks/ALUA/quote'), context('ALUA')),
    ])
    const cachedGgal = await GET(
      request('/api/stocks/GGAL/quote'),
      context('GGAL')
    )
    const cachedAlua = await GET(
      request('/api/stocks/ALUA/quote'),
      context('ALUA')
    )

    expect((await ggal.json()).symbol).toBe('GGAL')
    expect((await alua.json()).symbol).toBe('ALUA')
    expect(cachedGgal.headers.get('X-Quote-Cache')).toBe('memory-cache')
    expect(cachedAlua.headers.get('X-Quote-Cache')).toBe('memory-cache')
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })
})
