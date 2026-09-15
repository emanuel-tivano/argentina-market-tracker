import { NextRequest } from 'next/server'
import { STOCK_HISTORY_RANGES } from '@/lib/stockHistory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IolUpstreamNetworkError,
  isRecoverableIolUpstreamError,
} from '@/lib/server/upstream/iol'

const OLD_ENV = { ...process.env }
const LIVE_ENV_DEFAULTS = {
  MARKET_DATA_SOURCE: 'live',
  API_URL: 'https://api.example.test',
  TOKEN_ENDPOINT: 'token',
  API_USERNAME: 'user',
  API_PASSWORD: 'password',
} satisfies Record<string, string>

function setRequiredEnv(
  nodeEnv: NodeJS.ProcessEnv['NODE_ENV'] = 'test',
  overrides: Record<string, string | undefined> = {}
) {
  process.env = {
    ...OLD_ENV,
    ...LIVE_ENV_DEFAULTS,
    ...overrides,
    NODE_ENV: nodeEnv,
  }
}

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init)
}

function context(symbol: string) {
  return {
    params: Promise.resolve({ symbol }),
  }
}

function expectRequestIdHeader(response: Response, expected?: string) {
  const requestId = response.headers.get('X-Request-Id')

  if (expected) {
    expect(requestId).toBe(expected)
    return
  }

  expect(requestId).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
}

async function loadRoute(
  iolFetch: ReturnType<typeof vi.fn>,
  nodeEnv: NodeJS.ProcessEnv['NODE_ENV'] = 'test',
  envOverrides: Record<string, string | undefined> = {}
) {
  vi.resetModules()
  setRequiredEnv(nodeEnv, envOverrides)
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    iolFetch,
    isRecoverableIolUpstreamError,
  }))

  return import('./route')
}

async function loadLiveRoute(
  iolFetch: ReturnType<typeof vi.fn>,
  nodeEnv: NodeJS.ProcessEnv['NODE_ENV'] = 'test',
  envOverrides: Record<string, string | undefined> = {}
) {
  return loadRoute(iolFetch, nodeEnv, {
    MARKET_DATA_SOURCE: 'live',
    ...envOverrides,
  })
}

async function loadDemoRouteWithoutLiveEnv() {
  vi.resetModules()
  process.env = {
    ...OLD_ENV,
    NODE_ENV: 'test',
    MARKET_DATA_SOURCE: 'demo',
  }
  const iolFetch = vi.fn(() => {
    throw new Error('live upstream should not be used in demo mode')
  })
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    iolFetch,
    isRecoverableIolUpstreamError: (error: unknown) =>
      error instanceof Error && !(error instanceof TypeError),
  }))

  const route = await import('./route')

  return {
    ...route,
    iolFetch,
  }
}

async function clearHistoryTestState() {
  try {
    const [{ clearHistoryCacheForTests }, { clearHistoryRateLimitForTests }] =
      await Promise.all([
        import('@/lib/server/history/historyCache'),
        import('@/lib/server/history/historyRateLimit'),
      ])

    clearHistoryCacheForTests()
    clearHistoryRateLimitForTests()
  } catch {
    // Ignore cleanup before the first import of the server modules.
  }
}

describe('/api/stocks/[symbol]/history route', () => {
  describe.each(['demo', 'live'])('%s ranges', (source) => {
    it.each(STOCK_HISTORY_RANGES)('accepts %s', async (range) => {
      const iolFetch = vi.fn().mockResolvedValue([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
      const { GET } = await loadRoute(iolFetch, 'test', { MARKET_DATA_SOURCE: source })
      const response = await GET(
        request(`/api/stocks/ALUA/history?range=${range}&market=bCBA`), context('ALUA')
      )
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body).toMatchObject({ ok: true, symbol: 'ALUA', range, meta: { source } })
      expect(body.data.length).toBeGreaterThan(0)
      if (source === 'demo') expect(iolFetch).not.toHaveBeenCalled()
    })

    it.each(['2Y', '10Y', '3y', 'invalid'])('rejects %s with INVALID_RANGE', async (range) => {
      const iolFetch = vi.fn()
      const { GET } = await loadRoute(iolFetch, 'test', { MARKET_DATA_SOURCE: source })
      const response = await GET(
        request(`/api/stocks/ALUA/history?range=${range}&market=bCBA`), context('ALUA')
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_RANGE' })
      expect(iolFetch).not.toHaveBeenCalled()
    })
  })

  beforeEach(async () => {
    await clearHistoryTestState()
    vi.clearAllMocks()
    setRequiredEnv()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-07T15:00:00.000Z'))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    await clearHistoryTestState()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = { ...OLD_ENV }
  })

  it('fetches adjusted historical data through IOL and normalizes it', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      {
        fecha: '2026-05-07T00:00:00',
        ultimoPrecio: 101,
        apertura: 98,
        maximo: 102,
        minimo: 97,
        volumen: 1000,
      },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1M&market=bCBA'),
      context('GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: [
        {
          date: '2026-05-07',
          close: 101,
          open: 98,
          high: 102,
          low: 97,
          volume: 1000,
        },
      ],
      fetchedAt: '2026-05-07T15:00:00.000Z',
      servedAt: '2026-05-07T15:00:00.000Z',
      cacheStatus: 'fresh',
      range: '1M',
      market: 'bCBA',
      symbol: 'GGAL',
      meta: {
        invalidPoints: 0,
        duplicatePoints: 0,
        discardedPoints: 0,
        requestId: expect.any(String),
        resolvedVariant: 'ajustada',
        source: 'live',
        stale: false,
        totalPoints: 1,
      },
    })
    expect(iolFetch).toHaveBeenCalledWith(
      '/api/v2/bCBA/Titulos/GGAL/Cotizacion/seriehistorica/2026-04-06/2026-05-07/ajustada'
    )
    expect(iolFetch).toHaveBeenCalledTimes(1)
  })

  it('uses the same bCBA market endpoint for a panel general stock', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/YPFD/history?range=1M&market=bCBA'),
      context('YPFD')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.symbol).toBe('YPFD')
    expect(body.market).toBe('bCBA')
    expect(iolFetch).toHaveBeenCalledWith(
      '/api/v2/bCBA/Titulos/YPFD/Cotizacion/seriehistorica/2026-04-06/2026-05-07/ajustada'
    )
    expect(iolFetch).toHaveBeenCalledTimes(1)
  })

  it('uses bCBA and normalizes alternate CEDEAR historical fields', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      {
        fechaCotizacion: '2026-05-07T00:00:00',
        precio: 916,
      },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/AAPL/history?range=1M&market=bCBA'),
      context('AAPL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      data: [{ date: '2026-05-07', close: 916 }],
      market: 'bCBA',
      meta: { resolvedVariant: 'ajustada' },
      symbol: 'AAPL',
    })
    expect(iolFetch).toHaveBeenCalledWith(
      '/api/v2/bCBA/Titulos/AAPL/Cotizacion/seriehistorica/2026-04-06/2026-05-07/ajustada'
    )
    expect(iolFetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to unadjusted history when adjusted CEDEAR history is empty', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          fechaCotizacion: '2026-05-07T00:00:00',
          precio: 916,
        },
      ])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/AAPL/history?range=1M&market=bCBA'),
      context('AAPL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      data: [{ date: '2026-05-07', close: 916 }],
      market: 'bCBA',
      meta: { resolvedVariant: 'sinAjustar' },
      symbol: 'AAPL',
    })
    expect(iolFetch).toHaveBeenNthCalledWith(
      1,
      '/api/v2/bCBA/Titulos/AAPL/Cotizacion/seriehistorica/2026-04-06/2026-05-07/ajustada'
    )
    expect(iolFetch).toHaveBeenNthCalledWith(
      2,
      '/api/v2/bCBA/Titulos/AAPL/Cotizacion/seriehistorica/2026-04-06/2026-05-07/sinAjustar'
    )
  })

  it('uses defaults for market and range', async () => {
    const iolFetch = vi.fn().mockResolvedValue([])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(request('/api/stocks/ypfd/history'), context('ypfd'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.range).toBe('1M')
    expect(body.market).toBe('bCBA')
    expect(body.symbol).toBe('YPFD')
  })

  it('returns an empty data array when both IOL history variants are empty', async () => {
    const iolFetch = vi.fn().mockResolvedValue([])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/MSFT/history?range=1M&market=bCBA'),
      context('MSFT')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      data: [],
      market: 'bCBA',
      meta: { resolvedVariant: 'sinAjustar' },
      symbol: 'MSFT',
    })
    expect(iolFetch).toHaveBeenNthCalledWith(
      1,
      '/api/v2/bCBA/Titulos/MSFT/Cotizacion/seriehistorica/2026-04-06/2026-05-07/ajustada'
    )
    expect(iolFetch).toHaveBeenNthCalledWith(
      2,
      '/api/v2/bCBA/Titulos/MSFT/Cotizacion/seriehistorica/2026-04-06/2026-05-07/sinAjustar'
    )

    const cachedResponse = await GET(
      request('/api/stocks/MSFT/history?range=1M&market=bCBA'),
      context('MSFT')
    )
    const cachedBody = await cachedResponse.json()

    expect(cachedBody).toMatchObject({
      cacheStatus: 'memory-cache',
      data: [],
      meta: { resolvedVariant: 'sinAjustar' },
    })
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })

  it('returns filtered success when the upstream payload is partially invalid', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
      { fecha: 'invalid', ultimoPrecio: 99 },
    ])
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1M&market=bCBA'),
      context('GGAL')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      data: [{ date: '2026-05-07', close: 101 }],
      meta: {
        invalidPoints: 1,
        duplicatePoints: 0,
        discardedPoints: 1,
        resolvedVariant: 'ajustada',
        source: 'live',
        stale: false,
        totalPoints: 1,
      },
    })
    expect(consoleWarn).toHaveBeenCalledWith(
      '[history.normalize.partial]',
      expect.objectContaining({
        level: 'warn',
        symbol: 'GGAL',
        invalidPoints: 1,
        duplicatePoints: 0,
        discardedPoints: 1,
        totalPoints: 1,
      })
    )
    expect(iolFetch).toHaveBeenCalledTimes(1)
    expect(iolFetch.mock.calls[0]?.[0]).toContain('/ajustada')
  })

  it('deduplicates dates before exposing history counts', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-08', ultimoPrecio: 108 },
      { fecha: '2026-05-07', ultimoPrecio: 101 },
      { fecha: '2026-05-08', ultimoPrecio: 110 },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1M&market=bCBA'),
      context('GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([
      { date: '2026-05-07', close: 101 },
      { date: '2026-05-08', close: 110 },
    ])
    expect(body.meta).toMatchObject({
      invalidPoints: 0,
      duplicatePoints: 1,
      discardedPoints: 1,
      totalPoints: 2,
    })
    expect(body.meta.totalPoints).toBe(body.data.length)
  })

  it('returns HISTORY_ERROR when every history point is invalid', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: 'invalid', ultimoPrecio: 101 },
      { fecha: null, ultimoPrecio: 99 },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1M&market=bCBA'),
      context('GGAL')
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'HISTORY_ERROR',
      details: 'Upstream history payload contains no valid items',
    })
  })

  it('returns 400 for invalid inputs', async () => {
    const iolFetch = vi.fn()
    const { GET } = await loadLiveRoute(iolFetch)

    expect(
      (await GET(request('/api/stocks/GGAL/history?range=2Y'), context('GGAL')))
        .status
    ).toBe(400)
    expect(
      (
        await GET(
          request('/api/stocks/GGAL/history?market=../bad'),
          context('GGAL')
        )
      ).status
    ).toBe(400)
    expect(
      (await GET(request('/api/stocks/*/history'), context('*'))).status
    ).toBe(400)
    expect(iolFetch).not.toHaveBeenCalled()
  })

  it('returns INVALID_SYMBOL for malformed encoded symbols', async () => {
    const iolFetch = vi.fn()
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/%25E0%25A4%25A/history'),
      context('%E0%A4%A')
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'INVALID_SYMBOL',
    })
    expect(iolFetch).not.toHaveBeenCalled()
  })

  it('rejects markets outside the history allowlist', async () => {
    const iolFetch = vi.fn()
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/GGAL/history?market=NYSE'),
      context('GGAL')
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'INVALID_MARKET',
    })
    expect(iolFetch).not.toHaveBeenCalled()
  })

  it('rate limits repeated history requests from the same client', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET } = await loadLiveRoute(iolFetch, 'test', {
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    for (let index = 0; index < 120; index += 1) {
      const response = await GET(
        request('/api/stocks/GGAL/history?range=1W', {
          headers: { 'x-forwarded-for': '203.0.113.10' },
        }),
        context('GGAL')
      )

      expect(response.status).toBe(200)
    }

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1W', {
        headers: { 'x-forwarded-for': '203.0.113.10' },
      }),
      context('GGAL')
    )

    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect(Number(response.headers.get('Retry-After'))).toBeLessThanOrEqual(60)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'RATE_LIMITED',
    })
  })

  it('returns 503 JSON when the rate limit store is unavailable', async () => {
    const iolFetch = vi.fn()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        new Error(
          'redis failed for https://kv.internal.example.test using RATE_LIMIT_REDIS_REST_TOKEN-secret'
        )
      )
    )
    const { GET } = await loadLiveRoute(iolFetch, 'production', {
      RATE_LIMIT_STORE: 'redis-rest',
      RATE_LIMIT_REDIS_REST_URL: 'https://kv.internal.example.test',
      RATE_LIMIT_REDIS_REST_TOKEN: 'RATE_LIMIT_REDIS_REST_TOKEN-secret',
    })

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1W'),
      context('GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(body).toEqual({
      ok: false,
      error: 'RATE_LIMIT_UNAVAILABLE',
      requestId: expect.any(String),
    })
    expectRequestIdHeader(response, body.requestId)
    expect(iolFetch).not.toHaveBeenCalled()
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      'https://kv.internal.example.test'
    )
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      'RATE_LIMIT_REDIS_REST_TOKEN-secret'
    )
  })

  it('allows history requests again after the rate limit window expires', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET } = await loadLiveRoute(iolFetch, 'test', {
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    for (let index = 0; index < 120; index += 1) {
      await GET(
        request('/api/stocks/GGAL/history?range=1W', {
          headers: { 'x-forwarded-for': '203.0.113.20' },
        }),
        context('GGAL')
      )
    }

    const limitedResponse = await GET(
      request('/api/stocks/GGAL/history?range=1W', {
        headers: { 'x-forwarded-for': '203.0.113.20' },
      }),
      context('GGAL')
    )

    expect(limitedResponse.status).toBe(429)

    vi.setSystemTime(new Date('2026-05-07T15:01:01.000Z'))

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1W', {
        headers: { 'x-forwarded-for': '203.0.113.20' },
      }),
      context('GGAL')
    )

    expect(response.status).toBe(200)
  })

  it('prunes the history cache to the maximum key count', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET, getHistoryCacheSizeForTests } = await loadLiveRoute(iolFetch, 'test', {
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    for (let index = 0; index < 501; index += 1) {
      const symbol = `SYM${index}`

      await GET(
        request(`/api/stocks/${symbol}/history?range=1W`, {
          headers: {
            'x-forwarded-for': `198.51.${Math.floor(index / 256)}.${index % 256}`,
          },
        }),
        context(symbol)
      )
    }

    expect(getHistoryCacheSizeForTests()).toBe(500)
  })

  it('keeps stale history cached beyond the fresh ttl', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET, getHistoryCacheSizeForTests } = await loadLiveRoute(iolFetch, 'test', {
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    await GET(
      request('/api/stocks/GGAL/history?range=1W', {
        headers: { 'x-forwarded-for': '203.0.113.30' },
      }),
      context('GGAL')
    )

    expect(getHistoryCacheSizeForTests()).toBe(1)

    vi.setSystemTime(new Date('2026-05-07T15:05:01.000Z'))

    expect(getHistoryCacheSizeForTests()).toBe(1)
  })

  it('uses memory cache for repeated requests', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    await GET(request('/api/stocks/GGAL/history?range=1W'), context('GGAL'))
    const response = await GET(
      request('/api/stocks/GGAL/history?range=1W'),
      context('GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cacheStatus).toBe('memory-cache')
    expect(iolFetch).toHaveBeenCalledTimes(1)
    expect(body.meta).toMatchObject({
      stale: false,
      resolvedVariant: 'ajustada',
    })
  })

  it('caches a fallback history response without repeating either variant', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
    const { GET } = await loadLiveRoute(iolFetch)

    await GET(request('/api/stocks/AAPL/history?range=1W'), context('AAPL'))
    const response = await GET(
      request('/api/stocks/AAPL/history?range=1W'),
      context('AAPL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cacheStatus).toBe('memory-cache')
    expect(body.data).toEqual([{ date: '2026-05-07', close: 101 }])
    expect(body.meta.resolvedVariant).toBe('sinAjustar')
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })

  it('returns stale cached history when the upstream fails after the fresh ttl expires', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
      .mockRejectedValueOnce(new IolUpstreamNetworkError('upstream failed'))
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { GET } = await loadLiveRoute(iolFetch)

    const first = await GET(
      request('/api/stocks/GGAL/history?range=1W'),
      context('GGAL')
    )

    expect(first.status).toBe(200)

    vi.setSystemTime(new Date('2026-05-07T15:05:01.000Z'))

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1W'),
      context('GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      cacheStatus: 'stale',
      data: [{ date: '2026-05-07', close: 101 }],
      meta: {
        stale: true,
        resolvedVariant: 'ajustada',
        source: 'live',
      },
    })
    expect(consoleWarn).toHaveBeenCalledWith(
      '[history.stale-fallback]',
      expect.objectContaining({
        level: 'warn',
        symbol: 'GGAL',
        cachedPoints: 1,
      })
    )
  })

  it('does not expose upstream error details in production', async () => {
    const iolFetch = vi.fn().mockRejectedValue(new Error('upstream failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await loadLiveRoute(iolFetch, 'production')

    const response = await GET(
      request('/api/stocks/GGAL/history'),
      context('GGAL')
    )

    expect(response.status).toBe(502)
    const body = await response.json()

    expect(body).toMatchObject({
      ok: false,
      error: 'HISTORY_ERROR',
    })
    expect(body.requestId).toEqual(expect.any(String))
    expect(consoleError).toHaveBeenCalledWith(
      '[api.stocks.history.GET]',
      expect.objectContaining({
        level: 'error',
        requestId: body.requestId,
        route: '/api/stocks/[symbol]/history',
        symbol: 'GGAL',
        market: 'bCBA',
        range: '1M',
        error: expect.objectContaining({
          message: 'upstream failed',
        }),
      })
    )
  })

  it('returns 405 and Allow GET for POST requests', async () => {
    const iolFetch = vi.fn()
    const { POST } = await loadLiveRoute(iolFetch)

    const response = POST(request('/api/stocks/GGAL/history'))

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
    })
  })

  it('does not trust spoofed forwarded IP headers when proxy trust is disabled', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    let response = await GET(
      request('/api/stocks/GGAL/history?range=1W', {
        headers: { 'x-forwarded-for': '203.0.113.10' },
      }),
      context('GGAL')
    )

    for (let index = 1; index < 121; index += 1) {
      response = await GET(
        request('/api/stocks/GGAL/history?range=1W', {
          headers: { 'x-forwarded-for': `203.0.113.${index}` },
        }),
        context('GGAL')
      )
    }

    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect(Number(response.headers.get('Retry-After'))).toBeLessThanOrEqual(60)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('returns rate limit headers on successful history responses', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1W'),
      context('GGAL')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
    expect(response.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/)
    expectRequestIdHeader(response)
  })

  it('propagates a valid x-request-id and regenerates invalid values', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ])
    const { GET } = await loadLiveRoute(iolFetch)

    const propagated = await GET(
      request('/api/stocks/GGAL/history?range=1W', {
        headers: { 'x-request-id': 'req-12345678' },
      }),
      context('GGAL')
    )
    const regenerated = await GET(
      request('/api/stocks/GGAL/history?range=1W', {
        headers: { 'x-request-id': 'bad id' },
      }),
      context('GGAL')
    )

    expectRequestIdHeader(propagated, 'req-12345678')
    expectRequestIdHeader(regenerated)
    expect(regenerated.headers.get('X-Request-Id')).not.toBe('bad id')
  })

  it('serves deterministic demo history without live credentials', async () => {
    const { GET, iolFetch } = await loadDemoRouteWithoutLiveEnv()

    const response = await GET(
      request('/api/stocks/GGAL/history?range=1M&market=bCBA'),
      context('GGAL')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      market: 'bCBA',
      range: '1M',
      symbol: 'GGAL',
      meta: {
        invalidPoints: 0,
        duplicatePoints: 0,
        discardedPoints: 0,
        source: 'demo',
        stale: false,
      },
    })
    expect(body.data.length).toBeGreaterThan(20)
    expect(body.meta.resolvedVariant).toBeUndefined()
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        close: expect.any(Number),
      })
    )
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expectRequestIdHeader(response)
    expect(iolFetch).not.toHaveBeenCalled()
  })

  it('returns an empty deterministic history for unknown demo symbols', async () => {
    const { GET, iolFetch } = await loadDemoRouteWithoutLiveEnv()

    const response = await GET(
      request('/api/stocks/DEMOX/history?range=1M&market=bCBA'),
      context('DEMOX')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      symbol: 'DEMOX',
      data: [],
      meta: {
        source: 'demo',
        stale: false,
      },
    })
    expect(body.meta.resolvedVariant).toBeUndefined()
    expect(iolFetch).not.toHaveBeenCalled()
  })
})
