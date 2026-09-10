import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = process.env
const TEST_IDENTITY = { key: 'client:test', source: 'local-loopback' } as const

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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

function quoteResponse(symbol: string) {
  return {
    ultimoPrecio: symbol.length * 100,
    variacion: 1.5,
    apertura: 98,
    maximo: 101,
    minimo: 97,
    cierreAnterior: 98.5,
    volumenNominal: 12345,
    descripcionTitulo: `Descripcion ${symbol}`,
    puntas: [
      {
        cantidadCompra: 10,
        precioCompra: 99,
        precioVenta: 100,
        cantidadVenta: 8,
      },
    ],
  }
}

async function loadFavoritesService(
  getQuoteBySymbol: ReturnType<typeof vi.fn>,
  envOverrides: Record<string, string | undefined> = {}
) {
  vi.resetModules()
  setRequiredEnv('test', {
    FAVORITES_QUOTE_CONCURRENCY: process.env.FAVORITES_QUOTE_CONCURRENCY,
    ...envOverrides,
  })
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    getQuoteBySymbol,
    isRecoverableIolUpstreamError: (error: unknown) =>
      error instanceof Error && !(error instanceof TypeError),
    IolUpstreamHttpError: class IolUpstreamHttpError extends Error {
      constructor(
        message: string,
        public readonly status: number,
        public readonly upstreamPath = '/quote'
      ) {
        super(message)
      }
    },
  }))

  return import('./favoritesService')
}

describe('favoritesService', () => {
  const items = [{ market: 'bCBA' as const, symbol: 'GGAL' }]
  const options = { bypassCache: false, rateLimitIdentity: TEST_IDENTITY }

  it('caches confirmed 404s until the configured TTL, including manual refreshes', async () => {
    const lookup = vi.fn()
    const { getFavoritesResponse } = await loadFavoritesService(lookup, { STOCK_QUOTE_NOT_FOUND_TTL_MS: '1000' })
    const { IolUpstreamHttpError } = await import('@/lib/server/upstream/iol')
    lookup.mockRejectedValueOnce(new IolUpstreamHttpError('not found', 404, { statusText: 'Not Found', upstreamPath: '/quote' })).mockResolvedValueOnce(quoteResponse('GGAL'))
    expect((await getFavoritesResponse(items, options)).missingItems).toEqual(['bCBA:GGAL'])
    vi.advanceTimersByTime(999)
    expect((await getFavoritesResponse(items, { ...options, bypassCache: true })).missingItems).toEqual(['bCBA:GGAL'])
    expect(lookup).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    expect((await getFavoritesResponse(items, options)).rows).toHaveLength(1)
    expect((await getFavoritesResponse(items, options)).missingItems).toEqual([])
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it.each(['500', '429', 'timeout', 'network', 'normalization', 'rate-limit', 'store-unavailable'])('does not negatively cache %s failures', async (kind) => {
    const lookup = vi.fn()
    const { getFavoritesResponse } = await loadFavoritesService(lookup)
    const { IolUpstreamHttpError } = await import('@/lib/server/upstream/iol')
    const { QuoteUpstreamBudgetError } = await import('@/lib/server/quote/protectedQuoteLookup')
    const error = kind === '500' || kind === '429'
      ? new IolUpstreamHttpError('failed', Number(kind), { statusText: 'Failed', upstreamPath: '/quote' })
      : kind === 'rate-limit' || kind === 'store-unavailable'
        ? new QuoteUpstreamBudgetError(kind === 'rate-limit' ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE', kind === 'rate-limit' ? 429 : 503, {})
        : new Error(kind)
    if (kind === 'normalization') lookup.mockResolvedValueOnce(null)
    else lookup.mockRejectedValueOnce(error)
    lookup.mockResolvedValueOnce(quoteResponse('GGAL'))
    await expect(getFavoritesResponse(items, options)).rejects.toThrow()
    expect((await getFavoritesResponse(items, options)).rows).toHaveLength(1)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('preserves stale fallback during negative TTL and resumes lookup after expiry', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(quoteResponse('GGAL'))
    const { getFavoritesResponse } = await loadFavoritesService(lookup)
    const { IolUpstreamHttpError } = await import('@/lib/server/upstream/iol')
    await getFavoritesResponse(items, options)
    vi.advanceTimersByTime(15_001)
    lookup.mockRejectedValueOnce(new IolUpstreamHttpError('not found', 404, { statusText: 'Not Found', upstreamPath: '/quote' }))
    for (let count = 0; count < 2; count++) {
      const response = await getFavoritesResponse(items, options)
      expect(response.stale).toBe(true)
      expect(response.rows).toHaveLength(1)
      expect(response.missingItems).toEqual([])
    }
    expect(lookup).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(30_000)
    lookup.mockResolvedValueOnce(quoteResponse('GGAL'))
    expect((await getFavoritesResponse(items, options)).stale).toBe(false)
    expect(lookup).toHaveBeenCalledTimes(3)
  })

  beforeEach(() => {
    setRequiredEnv()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T18:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = OLD_ENV
  })

  it('does not execute more than the configured number of concurrent quote lookups', async () => {
    process.env.FAVORITES_QUOTE_CONCURRENCY = '2'
    let active = 0
    let maxActive = 0
    const queue: Array<{
      symbol: string
      task: ReturnType<typeof deferred<ReturnType<typeof quoteResponse>>>
    }> = []
    const getQuoteBySymbol = vi.fn((_market: string, symbol: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const task = deferred<ReturnType<typeof quoteResponse>>()
      queue.push({ symbol, task })

      return task.promise.finally(() => {
        active -= 1
      })
    })
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)

    const responsePromise = getFavoritesResponse(
      [
        { market: 'bCBA', symbol: 'ALUA' },
        { market: 'bCBA', symbol: 'AAPL' },
        { market: 'bCBA', symbol: 'AGRO' },
        { market: 'bCBA', symbol: 'BMA' },
      ],
      {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
      }
    )

    await Promise.resolve()
    expect(maxActive).toBe(2)
    expect(queue.map((entry) => entry.symbol)).toEqual(['ALUA', 'AAPL'])

    queue[0].task.resolve(quoteResponse(queue[0].symbol))
    await vi.waitFor(() => {
      expect(queue).toHaveLength(3)
    })
    expect(maxActive).toBe(2)

    queue[1].task.resolve(quoteResponse(queue[1].symbol))
    await vi.waitFor(() => {
      expect(queue).toHaveLength(4)
    })
    expect(maxActive).toBe(2)

    queue[2].task.resolve(quoteResponse(queue[2].symbol))
    queue[3].task.resolve(quoteResponse(queue[3].symbol))

    const response = await responsePromise

    expect(response.rows).toHaveLength(4)
    expect(getQuoteBySymbol).toHaveBeenCalledTimes(4)
  })

  it('uses the latest valid row fetch timestamp as updatedAt', async () => {
    const getQuoteBySymbol = vi.fn(async (_market: string, symbol: string) =>
      quoteResponse(symbol)
    )
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)

    const response = await getFavoritesResponse(
      [{ market: 'bCBA', symbol: 'ALUA' }],
      {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
      }
    )

    expect(response.rows).toHaveLength(1)
    expect(response.updatedAt).toBe('2026-05-27T18:00:00.000Z')
    expect(response.servedAt).toBe('2026-05-27T18:00:00.000Z')
  })

  it('keeps updatedAt tied to cached row data instead of the response time', async () => {
    vi.setSystemTime(new Date('2026-05-27T17:00:00.000Z'))
    const getQuoteBySymbol = vi.fn(async (_market: string, symbol: string) =>
      quoteResponse(symbol)
    )
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)
    const items = [{ market: 'bCBA' as const, symbol: 'ALUA' }]

    await getFavoritesResponse(items, {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
    })

    vi.setSystemTime(new Date('2026-05-27T17:00:10.000Z'))

    const response = await getFavoritesResponse(items, {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
    })

    expect(response.updatedAt).toBe('2026-05-27T17:00:00.000Z')
    expect(response.servedAt).toBe('2026-05-27T17:00:10.000Z')
    expect(getQuoteBySymbol).toHaveBeenCalledTimes(1)
  })

  it('timestamps a live quote after fetch completion and preserves it in cache', async () => {
    const quote = deferred<ReturnType<typeof quoteResponse>>()
    const getQuoteBySymbol = vi.fn(() => quote.promise)
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)
    const items = [{ market: 'bCBA' as const, symbol: 'ALUA' }]

    const responsePromise = getFavoritesResponse(items, {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
    })

    await vi.waitFor(() => expect(getQuoteBySymbol).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date('2026-05-27T18:00:05.000Z'))
    quote.resolve(quoteResponse('ALUA'))

    const fresh = await responsePromise

    expect(fresh.updatedAt).toBe('2026-05-27T18:00:05.000Z')

    vi.setSystemTime(new Date('2026-05-27T18:00:10.000Z'))
    const cached = await getFavoritesResponse(items, {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
    })

    expect(cached.updatedAt).toBe('2026-05-27T18:00:05.000Z')
    expect(cached.servedAt).toBe('2026-05-27T18:00:10.000Z')
    expect(getQuoteBySymbol).toHaveBeenCalledTimes(1)
  })

  it('uses a service timestamp instead of epoch for empty favorites', async () => {
    const getQuoteBySymbol = vi.fn()
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)

    const response = await getFavoritesResponse([], {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
    })

    expect(response.rows).toEqual([])
    expect(response.updatedAt).toBe('2026-05-27T18:00:00.000Z')
    expect(response.updatedAt).toBe(response.servedAt)
    expect(response.updatedAt).not.toBe(new Date(0).toISOString())
    expect(getQuoteBySymbol).not.toHaveBeenCalled()
  })

  it('uses a service timestamp instead of epoch when all favorites are missing', async () => {
    const getQuoteBySymbol = vi.fn()
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol, {
      MARKET_DATA_SOURCE: 'demo',
    })

    const response = await getFavoritesResponse(
      [{ market: 'bCBA', symbol: 'DEMOX' }],
      {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
      }
    )

    expect(response.rows).toEqual([])
    expect(response.missingItems).toEqual(['bCBA:DEMOX'])
    expect(response.updatedAt).toBe('2026-05-27T18:00:00.000Z')
    expect(response.updatedAt).toBe(response.servedAt)
    expect(response.updatedAt).not.toBe(new Date(0).toISOString())
    expect(getQuoteBySymbol).not.toHaveBeenCalled()
  })

  it('keeps partial success when one lookup fails under the concurrency limiter', async () => {
    process.env.FAVORITES_QUOTE_CONCURRENCY = '2'
    const getQuoteBySymbol = vi.fn(async (_market: string, symbol: string) => {
      if (symbol === 'AGRO') {
        throw new Error('upstream timeout')
      }

      return quoteResponse(symbol)
    })
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)

    const response = await getFavoritesResponse(
      [
        { market: 'bCBA', symbol: 'ALUA' },
        { market: 'bCBA', symbol: 'AGRO' },
        { market: 'bCBA', symbol: 'AAPL' },
      ],
      {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
      }
    )

    expect(response.rows.map((row) => row.simbolo)).toEqual(['ALUA', 'AAPL'])
    expect(response.failedItems).toEqual(['bCBA:AGRO'])
    expect(response.missingItems).toEqual([])
  })

  it('deduplicates repeated favorites before applying the concurrency limiter', async () => {
    process.env.FAVORITES_QUOTE_CONCURRENCY = '1'
    const getQuoteBySymbol = vi.fn(async (_market: string, symbol: string) =>
      quoteResponse(symbol)
    )
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)

    const response = await getFavoritesResponse(
      [
        { market: 'bCBA', symbol: 'GGAL' },
        { market: 'bCBA', symbol: 'GGAL' },
        { market: 'bCBA', symbol: 'AAPL' },
        { market: 'bCBA', symbol: 'AAPL' },
      ],
      {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
      }
    )

    expect(getQuoteBySymbol).toHaveBeenCalledTimes(2)
    expect(response.rows.map((row) => row.simbolo)).toEqual(['GGAL', 'AAPL'])
  })

  it('propagates a TypeError instead of hiding it with a stale favorite quote', async () => {
    const programmingFailure = new TypeError('broken favorite invariant')
    const getQuoteBySymbol = vi
      .fn()
      .mockResolvedValueOnce(quoteResponse('GGAL'))
      .mockRejectedValueOnce(programmingFailure)
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)
    const items = [{ market: 'bCBA' as const, symbol: 'GGAL' }]
    const options = {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
    }

    await getFavoritesResponse(items, options)
    vi.advanceTimersByTime(15_001)

    await expect(getFavoritesResponse(items, options)).rejects.toBe(
      programmingFailure
    )
  })

  it('records favorites batch metrics with unique count and concurrency limit', async () => {
    process.env.FAVORITES_QUOTE_CONCURRENCY = '3'
    const getQuoteBySymbol = vi.fn(async (_market: string, symbol: string) => {
      if (symbol === 'AGRO') {
        throw new Error('upstream timeout')
      }

      return quoteResponse(symbol)
    })
    const { getFavoritesResponse } = await loadFavoritesService(getQuoteBySymbol)
    const { clearObservabilityStateForTests, getObservabilitySnapshot } = await import(
      '@/lib/server/core/observability'
    )
    clearObservabilityStateForTests()

    await getFavoritesResponse(
      [
        { market: 'bCBA', symbol: 'GGAL' },
        { market: 'bCBA', symbol: 'GGAL' },
        { market: 'bCBA', symbol: 'AGRO' },
      ],
      {
      bypassCache: false,
      rateLimitIdentity: TEST_IDENTITY,
      requestId: 'req-12345678',
      }
    )

    expect(getObservabilitySnapshot().counters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'favorites.batch.total',
          tags: expect.objectContaining({
            batchSize: '3',
            uniqueItemCount: '2',
            concurrencyLimit: '3',
            failedCount: '1',
            source: 'live',
          }),
          value: 1,
        }),
      ])
    )
  })
})
