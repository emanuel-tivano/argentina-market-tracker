import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = { ...process.env }

function setRequiredEnv(
  nodeEnv: NodeJS.ProcessEnv['NODE_ENV'] = 'test',
  overrides: Record<string, string | undefined> = {}
) {
  process.env = {
    ...OLD_ENV,
    API_URL: 'https://api.example.test',
    TOKEN_ENDPOINT: 'token',
    API_USERNAME: 'user',
    API_PASSWORD: 'password',
    MARKET_DATA_SOURCE: 'live',
    ...overrides,
    NODE_ENV: nodeEnv,
  }
}

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init)
}

function expectRequestIdHeader(response: Response, expected?: string) {
  const requestId = response.headers.get('X-Request-Id')

  if (expected) {
    expect(requestId).toBe(expected)
    return
  }

  expect(requestId).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
}

function quoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    ultimoPrecio: 100,
    variacion: 1.5,
    apertura: 98,
    maximo: 101,
    minimo: 97,
    cierreAnterior: 98.5,
    volumenNominal: 12345,
    descripcionTitulo: 'Grupo Financiero Galicia',
    puntas: [
      {
        cantidadCompra: 10,
        precioCompra: 99,
        precioVenta: 100,
        cantidadVenta: 8,
      },
    ],
    ...overrides,
  }
}

async function loadRoute(
  getQuoteBySymbol: ReturnType<typeof vi.fn>,
  nodeEnv: NodeJS.ProcessEnv['NODE_ENV'] = 'test',
  envOverrides: Record<string, string | undefined> = {}
) {
  vi.resetModules()
  setRequiredEnv(nodeEnv, envOverrides)
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    getQuoteBySymbol,
    isRecoverableIolUpstreamError: (error: unknown) =>
      error instanceof Error && !(error instanceof TypeError),
    IolUpstreamHttpError: class IolUpstreamHttpError extends Error {
      constructor(
        message: string,
        public readonly status: number
      ) {
        super(message)
      }
    },
  }))

  return import('./route')
}

async function loadDemoRouteWithoutLiveEnv() {
  vi.resetModules()
  process.env = {
    NODE_ENV: 'test',
    MARKET_DATA_SOURCE: 'demo',
  }
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    getQuoteBySymbol: vi.fn(() => {
      throw new Error('live upstream should not be used in demo mode')
    }),
    IolUpstreamHttpError: class IolUpstreamHttpError extends Error {},
  }))

  return import('./route')
}

describe('/api/favorites route', () => {
  beforeEach(() => {
    setRequiredEnv()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T18:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = OLD_ENV
  })

  it('validates items input', async () => {
    const getQuoteBySymbol = vi.fn()
    const { GET } = await loadRoute(getQuoteBySymbol)

    const response = await GET(request('/api/favorites?items=bCBA:bad symbol'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'INVALID_ITEMS',
      requestId: expect.any(String),
    })
    expect(getQuoteBySymbol).not.toHaveBeenCalled()
  })

  it('limits the maximum number of favorites', async () => {
    const getQuoteBySymbol = vi.fn()
    const { GET } = await loadRoute(getQuoteBySymbol)
    const items = Array.from({ length: 26 }, (_, index) => `bCBA:SYM${index}`).join(',')

    const response = await GET(request(`/api/favorites?items=${items}`))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'TOO_MANY_ITEMS',
    })
    expect(getQuoteBySymbol).not.toHaveBeenCalled()
  })

  it('deduplicates repeated favorites and returns normalized rows', async () => {
    const getQuoteBySymbol = vi.fn().mockResolvedValue(quoteResponse())
    const { GET } = await loadRoute(getQuoteBySymbol)

    const response = await GET(
      request('/api/favorites?items=bCBA:GGAL,bCBA:ggal,bCBA:GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      rows: [
        {
          simbolo: 'GGAL',
          descripcion: 'Grupo Financiero Galicia',
          ultimoPrecio: 100,
          variacionPorcentual: 1.522842639593902,
        },
      ],
      missingItems: [],
      failedItems: [],
      source: 'live',
      requestId: expect.any(String),
      stale: false,
      updatedAt: '2026-05-26T18:00:00.000Z',
    })
    expect(getQuoteBySymbol).toHaveBeenCalledTimes(1)
    expect(getQuoteBySymbol).toHaveBeenCalledWith('bCBA', 'GGAL', {
      rateLimitIdentity: {
        key: 'loopback:localhost',
        source: 'local-loopback',
      },
      requestId: body.requestId,
      route: '/api/favorites',
    })
  })

  it('returns missingItems for unknown demo symbols', async () => {
    const { GET } = await loadDemoRouteWithoutLiveEnv()

    const response = await GET(
      request('/api/favorites?items=bCBA:GGAL,bCBA:DEMOX')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      rows: [
        {
          simbolo: 'GGAL',
          descripcion: 'Grupo Financiero Galicia',
        },
      ],
      missingItems: ['bCBA:DEMOX'],
      failedItems: [],
      source: 'demo',
      stale: false,
    })
    expectRequestIdHeader(response, body.requestId)
  })

  it('returns rate limit headers and request id on success', async () => {
    const getQuoteBySymbol = vi.fn().mockResolvedValue(quoteResponse())
    const { GET } = await loadRoute(getQuoteBySymbol)

    const response = await GET(request('/api/favorites?items=bCBA:GGAL'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
    expect(response.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/)
    expectRequestIdHeader(response, body.requestId)
  })

  it('rate limits repeated favorites requests from the same client', async () => {
    const getQuoteBySymbol = vi.fn().mockResolvedValue(quoteResponse())
    const { GET } = await loadRoute(getQuoteBySymbol, 'test', {
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    for (let index = 0; index < 120; index += 1) {
      const response = await GET(
        request('/api/favorites?items=bCBA:GGAL', {
          headers: { 'x-forwarded-for': '203.0.113.44' },
        })
      )

      expect(response.status).toBe(200)
    }

    const response = await GET(
      request('/api/favorites?items=bCBA:GGAL', {
        headers: { 'x-forwarded-for': '203.0.113.44' },
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'RATE_LIMITED',
    })
  })

  it('returns 503 JSON when the rate limit store is unavailable', async () => {
    const getQuoteBySymbol = vi.fn()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        new Error(
          'redis failed for https://kv.internal.example.test using RATE_LIMIT_REDIS_REST_TOKEN-secret'
        )
      )
    )
    const { GET } = await loadRoute(getQuoteBySymbol, 'production', {
      RATE_LIMIT_STORE: 'redis-rest',
      RATE_LIMIT_REDIS_REST_URL: 'https://kv.internal.example.test',
      RATE_LIMIT_REDIS_REST_TOKEN: 'RATE_LIMIT_REDIS_REST_TOKEN-secret',
    })

    const response = await GET(request('/api/favorites?items=bCBA:GGAL'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(body).toEqual({
      ok: false,
      error: 'RATE_LIMIT_UNAVAILABLE',
      requestId: expect.any(String),
    })
    expectRequestIdHeader(response, body.requestId)
    expect(getQuoteBySymbol).not.toHaveBeenCalled()
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      'https://kv.internal.example.test'
    )
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      'RATE_LIMIT_REDIS_REST_TOKEN-secret'
    )
  })

  it('returns successful rows and failedItems when one lookup fails', async () => {
    const getQuoteBySymbol = vi.fn(async (_market: string, symbol: string) => {
      if (symbol === 'AGRO') {
        throw new Error('upstream timeout')
      }

      return quoteResponse({
        descripcionTitulo: symbol === 'ALUA' ? 'Aluar' : 'Apple',
        ultimoPrecio: symbol === 'ALUA' ? 967.5 : 22860,
      })
    })
    const { GET } = await loadRoute(getQuoteBySymbol)

    const response = await GET(
      request('/api/favorites?items=bCBA:ALUA,bCBA:AGRO,bCBA:AAPL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      rows: [
        {
          simbolo: 'ALUA',
          descripcion: 'Aluar',
          ultimoPrecio: 967.5,
        },
        {
          simbolo: 'AAPL',
          descripcion: 'Apple',
          ultimoPrecio: 22860,
        },
      ],
      missingItems: [],
      failedItems: ['bCBA:AGRO'],
    })
  })

  it('returns failedItems in the error body when every lookup fails', async () => {
    const getQuoteBySymbol = vi.fn(async () => {
      throw new Error('upstream timeout')
    })
    const { GET } = await loadRoute(getQuoteBySymbol)

    const response = await GET(
      request('/api/favorites?items=bCBA:ALUA,bCBA:AGRO,bCBA:AAPL')
    )
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toMatchObject({
      ok: false,
      error: 'FAVORITES_ERROR',
      failedItems: ['bCBA:ALUA', 'bCBA:AGRO', 'bCBA:AAPL'],
      missingItems: [],
      details:
        'Favorites quote lookup failed for: bCBA:ALUA, bCBA:AGRO, bCBA:AAPL',
    })
  })
})
