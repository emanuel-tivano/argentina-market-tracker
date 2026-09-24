import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitIdentity } from '@/lib/server/core/rateLimit'
import type { StockQuoteSuccessResponse } from '@/lib/stockQuote'

const OLD_ENV = process.env

class MockIolUpstreamHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
  }
}

const identity: RateLimitIdentity = {
  key: 'loopback:localhost',
  source: 'local-loopback',
}

const context = {
  rateLimitIdentity: identity,
  route: '/stocks/[symbol]',
}

function quotePayload(overrides: Record<string, unknown> = {}) {
  return {
    simbolo: 'GGAL',
    mercado: 'bCBA',
    descripcionTitulo: 'Grupo Financiero Galicia',
    ultimoPrecio: 100,
    ...overrides,
  }
}

function cachedQuote(): StockQuoteSuccessResponse {
  return {
    ok: true,
    data: {
      symbol: 'GGAL',
      market: 'bCBA',
      description: 'Grupo Financiero Galicia',
      price: 100,
      variation: null,
      open: null,
      high: null,
      low: null,
      timestamp: null,
      previousClose: null,
      amountTraded: null,
      volume: null,
      averagePrice: null,
      currency: null,
      openInterest: null,
      operationCount: null,
      settlement: null,
      minimumSheet: null,
      lot: null,
      minimumQuantity: null,
      depth: [],
    },
    fetchedAt: '2026-07-15T15:00:00.000Z',
    servedAt: '2026-07-15T15:00:00.000Z',
    staleUntil: '2026-07-15T15:02:00.000Z',
    cacheStatus: 'fresh',
    stale: false,
    source: 'live',
    market: 'bCBA',
    symbol: 'GGAL',
  }
}

async function loadService(
  iolFetch: ReturnType<typeof vi.fn>,
  envOverrides: Record<string, string> = {}
) {
  vi.resetModules()
  process.env = {
    ...OLD_ENV,
    API_URL: 'https://api.example.test',
    API_USERNAME: 'user',
    API_PASSWORD: 'password',
    MARKET_DATA_SOURCE: 'live',
    NODE_ENV: 'test',
    RATE_LIMIT_STORE: 'memory',
    STOCK_QUOTE_NOT_FOUND_TTL_MS: '30000',
    ...envOverrides,
  }
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

  const service = await import('./quoteService')
  const cache = await import('./quoteCache')
  const limits = await import('./quoteRateLimit')

  return { cache, limits, service }
}

async function expectUpstreamBudgetCount(
  limits: typeof import('./quoteRateLimit'),
  expectedConsumedBeforeProbe: number
) {
  const probe = await limits.checkQuoteUpstreamBudget(identity)
  expect(probe.remaining).toBe(120 - expectedConsumedBeforeProbe - 1)
}

describe('quoteService upstream protection and cache ordering', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T15:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.resetModules()
    process.env = OLD_ENV
  })

  it('uses Cotizacion T1 once and fills omitted provider identity from the request', async () => {
    const iolFetch = vi.fn().mockResolvedValue(
      quotePayload({
        simbolo: undefined,
        mercado: undefined,
        volumenNominal: 1815042,
      })
    )
    const { limits, service } = await loadService(iolFetch)

    await expect(
      service.getStockQuoteResponse('ggal', 'bCBA', context)
    ).resolves.toMatchObject({
      cacheStatus: 'fresh',
      response: {
        source: 'live',
        data: {
          symbol: 'GGAL',
          market: 'bCBA',
          volume: 1815042,
        },
      },
    })
    expect(iolFetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v2/bCBA/Titulos/GGAL/Cotizacion?mercado=bcba&simbolo=GGAL&model.simbolo=GGAL&model.mercado=bCBA&model.plazo=t1'
    )
    await expectUpstreamBudgetCount(limits, 1)
  })

  it('serves a fresh positive cache hit without consuming upstream budget', async () => {
    const iolFetch = vi.fn()
    const { cache, limits, service } = await loadService(iolFetch)
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())

    const result = await service.getStockQuoteResponse('ggal', 'bCBA', context)

    expect(result).toMatchObject({ cacheStatus: 'memory-cache' })
    expect(iolFetch).not.toHaveBeenCalled()
    await expectUpstreamBudgetCount(limits, 0)
  })

  it('serves fresh positive and negative cache hits while Redis is unavailable', async () => {
    const redisFetch = vi.fn(
      () => new Promise<Response>(() => undefined)
    )
    vi.stubGlobal('fetch', redisFetch)
    const iolFetch = vi.fn()
    const { cache, service } = await loadService(iolFetch, {
      RATE_LIMIT_STORE: 'redis-rest',
      RATE_LIMIT_REDIS_REST_URL: 'https://redis.example.test',
      RATE_LIMIT_REDIS_REST_TOKEN: 'secret-token',
    })
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())
    cache.setCachedStockQuoteNotFound('bCBA', 'NOPE')

    const positive = await service.getStockQuoteResponse('GGAL', 'bCBA', context)
    const negative = await service.getStockQuoteResponse('nope', 'bCBA', context)

    expect(positive.cacheStatus).toBe('memory-cache')
    expect(negative).toMatchObject({
      cacheStatus: 'negative-cache',
      response: null,
    })
    expect(redisFetch).not.toHaveBeenCalled()
    expect(iolFetch).not.toHaveBeenCalled()
  })

  it('serves stale when the upstream budget store is unavailable', async () => {
    const redisFetch = vi.fn().mockRejectedValue(new Error('redis offline'))
    vi.stubGlobal('fetch', redisFetch)
    const iolFetch = vi.fn()
    const { cache, service } = await loadService(iolFetch, {
      RATE_LIMIT_STORE: 'redis-rest',
      RATE_LIMIT_REDIS_REST_URL: 'https://redis.example.test',
      RATE_LIMIT_REDIS_REST_TOKEN: 'secret-token',
    })
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())
    vi.advanceTimersByTime(15_001)

    const result = await service.getStockQuoteResponse('GGAL', 'bCBA', context)

    expect(result.cacheStatus).toBe('stale')
    expect(redisFetch).toHaveBeenCalledOnce()
    expect(iolFetch).not.toHaveBeenCalled()
  })

  it('deduplicates provider calls and consumes upstream budget once', async () => {
    let resolve!: (value: ReturnType<typeof quotePayload>) => void
    const pending = new Promise<ReturnType<typeof quotePayload>>((done) => {
      resolve = done
    })
    const iolFetch = vi.fn().mockReturnValue(pending)
    const { limits, service } = await loadService(iolFetch)

    const first = service.getStockQuoteResponse('GGAL', 'bCBA', context)
    const second = service.getStockQuoteResponse('ggal', 'bCBA', context)
    await vi.waitFor(() => expect(iolFetch).toHaveBeenCalledOnce())
    resolve(quotePayload())
    await Promise.all([first, second])

    expect(iolFetch).toHaveBeenCalledOnce()
    await expectUpstreamBudgetCount(limits, 1)
  })

  it('rejects a mismatched upstream symbol without caching it', async () => {
    const iolFetch = vi.fn().mockResolvedValue(
      quotePayload({ simbolo: 'AAPL' })
    )
    const { cache, service } = await loadService(iolFetch)

    await expect(
      service.getStockQuoteResponse('GGAL', 'bCBA', context)
    ).rejects.toThrow('identity does not match')

    expect(cache.getCachedStockQuoteResponse('bCBA', 'GGAL')).toBeNull()
  })

  it('accepts case-only differences in upstream quote identity', async () => {
    const iolFetch = vi.fn().mockResolvedValue(
      quotePayload({ simbolo: 'ggal', mercado: 'BCBA' })
    )
    const { service } = await loadService(iolFetch)

    await expect(
      service.getStockQuoteResponse('GGAL', 'bCBA', context)
    ).resolves.toMatchObject({
      response: {
        data: { symbol: 'ggal', market: 'BCBA' },
        symbol: 'GGAL',
        market: 'bCBA',
      },
    })
  })

  it('rejects a mismatched upstream market', async () => {
    const iolFetch = vi.fn().mockResolvedValue(
      quotePayload({ mercado: 'NASDAQ' })
    )
    const { cache, service } = await loadService(iolFetch)

    await expect(
      service.getStockQuoteResponse('GGAL', 'bCBA', context)
    ).rejects.toThrow('identity does not match')

    expect(cache.getCachedStockQuoteResponse('bCBA', 'GGAL')).toBeNull()
  })

  it('consumes one new budget unit only after the full positive cache window expires', async () => {
    const iolFetch = vi.fn().mockResolvedValue(quotePayload())
    const { cache, limits, service } = await loadService(iolFetch)
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())

    await service.getStockQuoteResponse('GGAL', 'bCBA', context)
    vi.advanceTimersByTime(120_001)
    await service.getStockQuoteResponse('GGAL', 'bCBA', context)

    expect(iolFetch).toHaveBeenCalledOnce()
    await expectUpstreamBudgetCount(limits, 1)
  })

  it('negative-caches a confirmed 404 and skips provider and budget on the second request', async () => {
    const iolFetch = vi
      .fn()
      .mockRejectedValue(new MockIolUpstreamHttpError('missing', 404))
    const { cache, limits, service } = await loadService(iolFetch)

    const first = await service.getStockQuoteResponse('NOPE', 'bCBA', context)
    const second = await service.getStockQuoteResponse('nope', 'bCBA', context)

    expect(first).toMatchObject({ cacheStatus: 'fresh', response: null })
    expect(second).toMatchObject({
      cacheStatus: 'negative-cache',
      response: null,
    })
    expect(iolFetch).toHaveBeenCalledOnce()
    await expectUpstreamBudgetCount(limits, 1)
    expect(cache.hasCachedStockQuoteNotFound('bCBA', 'NOPE')).toBe(true)
  })

  it('prefers stale over a provider 404 and creates negative cache only after stale expires', async () => {
    const iolFetch = vi
      .fn()
      .mockRejectedValue(new MockIolUpstreamHttpError('missing', 404))
    const { cache, service } = await loadService(iolFetch)
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())
    vi.advanceTimersByTime(15_001)

    const stale = await service.getStockQuoteResponse('GGAL', 'bCBA', context)

    expect(stale).toMatchObject({ cacheStatus: 'stale', response: { symbol: 'GGAL' } })
    expect(cache.hasCachedStockQuoteNotFound('bCBA', 'GGAL')).toBe(false)

    vi.advanceTimersByTime(105_001)
    const missing = await service.getStockQuoteResponse('GGAL', 'bCBA', context)
    const negative = await service.getStockQuoteResponse('GGAL', 'bCBA', context)

    expect(missing.response).toBeNull()
    expect(negative.cacheStatus).toBe('negative-cache')
    expect(cache.hasCachedStockQuoteNotFound('bCBA', 'GGAL')).toBe(true)
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })

  it('does not hide persistent authentication failures with stale quote data', async () => {
    const authFailure = new MockIolUpstreamHttpError('unauthorized', 401)
    const iolFetch = vi.fn().mockRejectedValue(authFailure)
    const { cache, service } = await loadService(iolFetch)
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())
    vi.advanceTimersByTime(15_001)

    await expect(
      service.getStockQuoteResponse('GGAL', 'bCBA', context)
    ).rejects.toBe(authFailure)
  })

  it('propagates a TypeError instead of hiding it with stale quote data', async () => {
    const programmingFailure = new TypeError('broken quote invariant')
    const iolFetch = vi.fn().mockRejectedValue(programmingFailure)
    const { cache, service } = await loadService(iolFetch)
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())
    vi.advanceTimersByTime(15_001)

    await expect(
      service.getStockQuoteResponse('GGAL', 'bCBA', context)
    ).rejects.toBe(programmingFailure)
  })

  it('uses stale for a typed invalid upstream quote response', async () => {
    const iolFetch = vi.fn().mockResolvedValue({ simbolo: 'GGAL' })
    const { cache, service } = await loadService(iolFetch)
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())
    vi.advanceTimersByTime(15_001)

    const result = await service.getStockQuoteResponse(
      'GGAL',
      'bCBA',
      context
    )

    expect(result.cacheStatus).toBe('stale')
    expect(result.response?.stale).toBe(true)
  })

  it('does not return a stale snapshot that expires while refresh is in flight', async () => {
    let rejectRefresh!: (error: Error) => void
    const refresh = new Promise<never>((_resolve, reject) => {
      rejectRefresh = reject
    })
    const iolFetch = vi.fn().mockReturnValue(refresh)
    const { cache, service } = await loadService(iolFetch)
    cache.setCachedStockQuoteResponse('bCBA', 'GGAL', cachedQuote())
    vi.advanceTimersByTime(119_999)

    const request = service.getStockQuoteResponse('GGAL', 'bCBA', context)
    await vi.waitFor(() => expect(iolFetch).toHaveBeenCalledOnce())
    vi.advanceTimersByTime(2)
    const failure = new Error('refresh failed')
    const expectation = expect(request).rejects.toBe(failure)
    rejectRefresh(failure)

    await expectation
  })

  it.each([
    ['provider 500', new MockIolUpstreamHttpError('provider failed', 500)],
    ['upstream timeout', new Error('IOL request timed out after 20000ms')],
  ])('does not negative-cache %s failures', async (_label, failure) => {
    const iolFetch = vi.fn().mockRejectedValue(failure)
    const { cache, service } = await loadService(iolFetch)

    await expect(
      service.getStockQuoteResponse('NOPE', 'bCBA', context)
    ).rejects.toBe(failure)
    await expect(
      service.getStockQuoteResponse('NOPE', 'bCBA', context)
    ).rejects.toBe(failure)

    expect(iolFetch).toHaveBeenCalledTimes(2)
    expect(cache.hasCachedStockQuoteNotFound('bCBA', 'NOPE')).toBe(false)
  })
})
