import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockQuoteDetail } from '@/lib/stockQuote'

vi.mock('server-only', () => ({}))

import {
  clearQuoteCacheForTests,
  getCachedQuote,
  getOrCreateInFlightQuoteRequest,
  getStaleQuote,
  hasCachedQuoteNotFound,
  setCachedQuote,
  setCachedQuoteNotFound,
} from './quoteCache'
import {
  clearStockQuoteCacheForTests,
  getCachedStockQuoteResponse,
  getStaleStockQuoteResponse,
  hasCachedStockQuoteNotFound,
  setCachedStockQuoteNotFound,
  setCachedStockQuoteResponse,
} from '@/lib/server/quote/quoteCache'

const OLD_ENV = { ...process.env }
const STARTED_AT = new Date('2026-07-22T12:00:00.000Z')

function favoriteQuote(symbol = 'GGAL') {
  return {
    data: {
      simbolo: symbol,
      descripcion: `Descripcion ${symbol}`,
      ultimoPrecio: 100,
    },
    fetchedAt: STARTED_AT.toISOString(),
  }
}

function detailQuote(symbol = 'GGAL'): StockQuoteDetail {
  return {
    symbol,
    market: 'bCBA',
    description: `Descripcion ${symbol}`,
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
  }
}

describe('favorites quote cache policy', () => {
  it('isolates negative resources, expires entries and invalidates them on success', () => {
    process.env.STOCK_QUOTE_NOT_FOUND_TTL_MS = '1000'
    setCachedQuoteNotFound('bCBA', 'GGAL')
    expect(hasCachedQuoteNotFound('bCBA', 'GGAL')).toBe(true)
    expect(hasCachedStockQuoteNotFound('bCBA', 'GGAL')).toBe(false)
    setCachedStockQuoteNotFound('bCBA', 'ALUA')
    expect(hasCachedQuoteNotFound('bCBA', 'ALUA')).toBe(false)
    setCachedQuote('bCBA', 'GGAL', favoriteQuote())
    expect(hasCachedQuoteNotFound('bCBA', 'GGAL')).toBe(false)
    setCachedQuoteNotFound('bCBA', 'GGAL')
    vi.advanceTimersByTime(999)
    expect(hasCachedQuoteNotFound('bCBA', 'GGAL')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(hasCachedQuoteNotFound('bCBA', 'GGAL')).toBe(false)
  })

  it('bounds and clears negative entries independently of positive snapshots', () => {
    for (let index = 0; index <= 500; index++) setCachedQuoteNotFound('bCBA', `TEST${index}`)
    expect(hasCachedQuoteNotFound('bCBA', 'TEST0')).toBe(false)
    expect(hasCachedQuoteNotFound('bCBA', 'TEST500')).toBe(true)
    clearQuoteCacheForTests()
    expect(hasCachedQuoteNotFound('bCBA', 'TEST500')).toBe(false)
  })

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' }
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT)
    clearQuoteCacheForTests()
    clearStockQuoteCacheForTests()
  })

  afterEach(() => {
    clearQuoteCacheForTests()
    clearStockQuoteCacheForTests()
    vi.useRealTimers()
    process.env = { ...OLD_ENV }
  })

  it('uses custom fresh/stale TTLs consistently with the individual quote cache', () => {
    process.env.STOCK_QUOTE_FRESH_TTL_MS = '1000'
    process.env.STOCK_QUOTE_STALE_TTL_MS = '5000'
    setCachedQuote('bCBA', 'GGAL', favoriteQuote())
    setCachedStockQuoteResponse('bCBA', 'GGAL', {
      data: detailQuote(),
      source: 'live',
    })

    vi.setSystemTime(STARTED_AT.getTime() + 999)
    expect(getCachedQuote('bCBA', 'GGAL')).not.toBeNull()
    expect(getCachedStockQuoteResponse('bCBA', 'GGAL')).not.toBeNull()

    vi.setSystemTime(STARTED_AT.getTime() + 1_000)
    expect(getCachedQuote('bCBA', 'GGAL')).toBeNull()
    expect(getCachedStockQuoteResponse('bCBA', 'GGAL')).toBeNull()
    expect(getStaleQuote('bCBA', 'GGAL')).not.toBeNull()
    expect(getStaleStockQuoteResponse('bCBA', 'GGAL')).not.toBeNull()

    vi.setSystemTime(STARTED_AT.getTime() + 4_999)
    expect(getStaleQuote('bCBA', 'GGAL')).not.toBeNull()
    expect(getStaleStockQuoteResponse('bCBA', 'GGAL')).not.toBeNull()

    vi.setSystemTime(STARTED_AT.getTime() + 5_000)
    expect(getStaleQuote('bCBA', 'GGAL')).toBeNull()
    expect(getStaleStockQuoteResponse('bCBA', 'GGAL')).toBeNull()
  })

  it('uses the env defaults for both caches when fresh is not lower than stale', () => {
    process.env.STOCK_QUOTE_FRESH_TTL_MS = '5000'
    process.env.STOCK_QUOTE_STALE_TTL_MS = '5000'
    setCachedQuote('bCBA', 'GGAL', favoriteQuote())
    setCachedStockQuoteResponse('bCBA', 'GGAL', {
      data: detailQuote(),
      source: 'live',
    })

    vi.setSystemTime(STARTED_AT.getTime() + 14_999)
    expect(getCachedQuote('bCBA', 'GGAL')).not.toBeNull()
    expect(getCachedStockQuoteResponse('bCBA', 'GGAL')).not.toBeNull()

    vi.setSystemTime(STARTED_AT.getTime() + 15_000)
    expect(getCachedQuote('bCBA', 'GGAL')).toBeNull()
    expect(getCachedStockQuoteResponse('bCBA', 'GGAL')).toBeNull()
    expect(getStaleQuote('bCBA', 'GGAL')).not.toBeNull()
    expect(getStaleStockQuoteResponse('bCBA', 'GGAL')).not.toBeNull()

    vi.setSystemTime(STARTED_AT.getTime() + 120_000)
    expect(getStaleQuote('bCBA', 'GGAL')).toBeNull()
    expect(getStaleStockQuoteResponse('bCBA', 'GGAL')).toBeNull()
  })

  it('continues deduplicating concurrent requests for the same quote', async () => {
    let resolveRequest!: (value: ReturnType<typeof favoriteQuote>) => void
    const pending = new Promise<ReturnType<typeof favoriteQuote>>((resolve) => {
      resolveRequest = resolve
    })
    const factory = vi.fn(() => pending)

    const first = getOrCreateInFlightQuoteRequest('bCBA', 'GGAL', factory)
    const second = getOrCreateInFlightQuoteRequest('bCBA', 'GGAL', factory)

    expect(second).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)

    resolveRequest(favoriteQuote())
    await expect(first).resolves.toEqual(favoriteQuote())

    getOrCreateInFlightQuoteRequest('bCBA', 'GGAL', factory)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('keeps the cache bounded to its maximum key count', () => {
    for (let index = 0; index <= 500; index += 1) {
      const symbol = `TEST${String(index).padStart(3, '0')}`
      setCachedQuote('bCBA', symbol, favoriteQuote(symbol))
    }

    expect(getCachedQuote('bCBA', 'TEST000')).toBeNull()
    expect(getCachedQuote('bCBA', 'TEST500')).not.toBeNull()
  })
})
