import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchStockQuote,
  StockQuoteRequestError,
} from './stockQuoteClient'

function quoteResponse(overrides: Record<string, unknown> = {}) {
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
    servedAt: '2026-07-15T15:00:31.000Z',
    staleUntil: '2026-07-15T15:02:00.000Z',
    cacheStatus: 'stale',
    stale: true,
    degradationReason: 'upstream-unavailable',
    source: 'live',
    market: 'bCBA',
    symbol: 'GGAL',
    ...overrides,
  }
}

describe('stockQuoteClient freshness contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves a valid stale response', async () => {
    const stale = quoteResponse()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(stale)))

    await expect(
      fetchStockQuote('/api/stocks/GGAL/quote?market=bCBA')
    ).resolves.toEqual(stale)
  })

  it('preserves a coherent memory-cache response for hydration', async () => {
    const cached = quoteResponse({
      cacheStatus: 'memory-cache',
      stale: false,
      degradationReason: undefined,
    })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(cached)))

    await expect(
      fetchStockQuote('/api/stocks/GGAL/quote?market=bCBA')
    ).resolves.toEqual(cached)
  })

  it('rejects a response whose root and data symbols differ', async () => {
    const mismatched = quoteResponse({
      data: {
        ...quoteResponse().data,
        symbol: 'AAPL',
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(mismatched)))

    await expect(
      fetchStockQuote('/api/stocks/GGAL/quote?market=bCBA')
    ).rejects.toThrow('contrato de cotización inválido')
  })

  it('accepts case-only differences between root and data identity', async () => {
    const response = quoteResponse({
      symbol: 'ggal',
    })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(response)))

    await expect(
      fetchStockQuote('/api/stocks/GGAL/quote?market=bCBA')
    ).resolves.toEqual(response)
  })

  it.each([
    { cacheStatus: 'fresh', stale: false, degradationReason: 'upstream-unavailable' },
    { fetchedAt: '2026-02-30T15:00:00.000Z' },
    { servedAt: '2026-07-15T14:59:59.999Z' },
    { staleUntil: '2026-07-15T15:00:00.000Z' },
  ])('rejects contradictory quote freshness metadata %#', async (overrides) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(quoteResponse(overrides)))
    )

    await expect(
      fetchStockQuote('/api/stocks/GGAL/quote?market=bCBA')
    ).rejects.toThrow('contrato de cotización inválido')
  })

  it('rejects a response whose stale flag contradicts cacheStatus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(quoteResponse({ cacheStatus: 'memory-cache' }))
      )
    )

    await expect(
      fetchStockQuote('/api/stocks/GGAL/quote?market=bCBA')
    ).rejects.toThrow('contrato de cotización inválido')
  })

  it('preserves status, code and a valid Retry-After value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { ok: false, error: 'RATE_LIMITED' },
          { status: 429, headers: { 'Retry-After': '45' } }
        )
      )
    )

    const error = await fetchStockQuote('/api/stocks/GGAL/quote?market=bCBA').catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(StockQuoteRequestError)
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSec: 45,
    })
  })

  it.each(['-1', 'later', '1.5'])(
    'ignores invalid Retry-After seconds: %s',
    async (retryAfter) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { ok: false, error: 'RATE_LIMITED' },
            { status: 429, headers: { 'Retry-After': retryAfter } }
          )
        )
      )

      const error = await fetchStockQuote(
        '/api/stocks/GGAL/quote?market=bCBA'
      ).catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(StockQuoteRequestError)
      expect((error as StockQuoteRequestError).retryAfterSec).toBeUndefined()
    }
  )
})
