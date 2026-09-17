import { describe, expect, it } from 'vitest'
import { type StockData } from '@/features/dashboard/shared/stockData'
import { resolveCurrentStockQuote } from './currentStockQuote'
import {
  getArgentinaMarketStatus,
  mergeLiveQuoteIntoHistoricalSeries,
  shouldUseLiveCandle,
} from './liveSessionCandle'
import { syncHistoryWithCurrentQuote } from './historyQuoteSync'
import { type StockQuoteDetail } from '@/lib/stockQuote'

const snapshot: StockData = {
  ticker: 'ALUA',
  description: 'Aluar',
  price: 1028,
  var: -0.48,
  varType: 'negative',
  buyQty: 10,
  buyPrice: 1027,
  sellPrice: 1029,
  sellQty: 20,
  open: 1015,
  min: 1008,
  max: 1032,
  close: 1032.95,
  volume: 5000,
  quoteDate: '2026-06-24T20:00:00.000Z',
}

const detail: StockQuoteDetail = {
  symbol: 'GGAL',
  market: 'bcba',
  description: 'Grupo Financiero Galicia S.A',
  price: 7615,
  variation: -4.33,
  open: 7860,
  high: 7950,
  low: 7575,
  timestamp: '2026-06-24T16:59:55.3901383-03:00',
  previousClose: 7960,
  amountTraded: 20190703365,
  volume: 0,
  averagePrice: 0,
  currency: 'peso_Argentino',
  openInterest: 0,
  operationCount: 8864,
  settlement: 't1',
  minimumSheet: 1,
  lot: 1,
  minimumQuantity: 1,
  depth: [
    {
      buyQuantity: 1,
      buyPrice: 7500,
      sellPrice: 8050,
      sellQuantity: 85,
    },
  ],
}

describe('resolveCurrentStockQuote', () => {
  it('prioritizes CotizacionDetalle over the panel snapshot', () => {
    const currentQuote = resolveCurrentStockQuote(snapshot, [], detail)

    expect(currentQuote).toMatchObject({
      price: 7615,
      variation: -4.33,
      previousClose: 7960,
      amountTraded: 20190703365,
      operationCount: 8864,
      description: 'Grupo Financiero Galicia S.A',
      source: 'detail',
    })
    expect(currentQuote.depth).toEqual(detail.depth)
  })

  it('keeps the panel nominal volume when CotizacionDetalle returns zero', () => {
    expect(resolveCurrentStockQuote(snapshot, [], detail).volume).toBe(5000)
  })

  it('uses a dash-compatible null when no source has an informed volume', () => {
    expect(
      resolveCurrentStockQuote(
        { ...snapshot, volume: 0 },
        [{ date: '2026-06-24', close: 1028, volume: 0 }],
        detail
      ).volume
    ).toBeNull()
  })

  it('calculates previous close only when CotizacionDetalle omits a valid value', () => {
    expect(
      resolveCurrentStockQuote(snapshot, [], {
        ...detail,
        previousClose: 0,
      }).previousClose
    ).toBeCloseTo(7959.65, 1)
  })

  it('prioritizes the current snapshot when historical data differs', () => {
    const currentQuote = resolveCurrentStockQuote(
      { ...snapshot, amountTraded: 772426764.5 },
      [
      { date: '2026-06-23', close: 1008 },
      {
        date: '2026-06-24',
        close: 1037,
        amountTraded: 999,
        dailyVariation: 2.88,
        open: 1020,
        high: 1040,
        low: 1010,
      },
      ]
    )

    expect(currentQuote).toMatchObject({
      price: 1028,
      variation: -0.48,
      open: 1015,
      previousClose: 1032.95,
      low: 1008,
      high: 1032,
      volume: 5000,
      amountTraded: 772426764.5,
      source: 'snapshot',
    })
  })

  it('falls back to the latest historical amount when the snapshot omits it', () => {
    expect(
      resolveCurrentStockQuote(snapshot, [
        { date: '2026-06-23', close: 1008, amountTraded: 123 },
        { date: '2026-06-24', close: 1037, amountTraded: 772426764.5 },
      ]).amountTraded
    ).toBe(772426764.5)
  })

  it('keeps a snapshot amount of zero instead of using history', () => {
    expect(
      resolveCurrentStockQuote(
        { ...snapshot, amountTraded: 0 },
        [{ date: '2026-06-24', close: 1037, amountTraded: 999 }]
      ).amountTraded
    ).toBe(0)
  })

  it('keeps amount traded unavailable when neither source provides it', () => {
    expect(
      resolveCurrentStockQuote(snapshot, [
        { date: '2026-06-24', close: 1037 },
      ]).amountTraded
    ).toBeNull()
  })

  it('calculates previous close when the snapshot close repeats current price', () => {
    expect(
      resolveCurrentStockQuote(
        {
          ...snapshot,
          price: 7615,
          var: -4.33,
          close: 7615,
        },
        [{ date: '2026-06-23', close: 7900 }]
      ).previousClose
    ).toBeCloseTo(7959.65, 1)
  })

  it('keeps matching current and previous prices for zero variation', () => {
    expect(
      resolveCurrentStockQuote(
        {
          ...snapshot,
          price: 7615,
          var: 0,
          close: 7615,
        },
        [{ date: '2026-06-23', close: 7900 }]
      ).previousClose
    ).toBe(7615)
  })

  it('falls back to the latest valid historical point without a snapshot', () => {
    const currentQuote = resolveCurrentStockQuote(
      { ...snapshot, price: null, var: null },
      [
        { date: '2026-06-22', close: 1000 },
        { date: '2026-06-24', close: 0 },
        { date: '2026-06-23', close: 1020, dailyVariation: 2 },
      ]
    )

    expect(currentQuote).toMatchObject({
      price: 1020,
      variation: 2,
      previousClose: 1000,
      source: 'history',
    })
  })
})

describe('live session candles', () => {
  const openMarketNow = new Date('2026-06-24T18:00:00.000Z')
  const closedMarketNow = new Date('2026-06-25T04:00:00.000Z')
  const liveDetail = resolveCurrentStockQuote(snapshot, [], {
    ...detail,
    timestamp: '2026-06-24T14:30:00.000-03:00',
  })

  it('does not create a candle while the market is closed', () => {
    const historical = [{ date: '2026-06-23', close: 7960 }]

    expect(
      mergeLiveQuoteIntoHistoricalSeries(historical, liveDetail, {
        now: closedMarketNow,
        quoteSource: 'live',
      })
    ).toEqual({
      points: historical,
      liveSessionCandle: null,
    })
  })

  it('creates a provisional candle from a real operation during market hours', () => {
    const result = mergeLiveQuoteIntoHistoricalSeries(
      [{ date: '2026-06-23', close: 7960 }],
      liveDetail,
      {
        now: openMarketNow,
        quoteSource: 'live',
      }
    )

    expect(result.points.at(-1)).toMatchObject({
      date: '2026-06-24',
      timestamp: '2026-06-24T14:30:00.000-03:00',
      open: 7860,
      high: 7950,
      low: 7575,
      close: 7615,
    })
    expect(result.liveSessionCandle).not.toBeNull()
  })

  it('rejects a live quote without a real operation timestamp', () => {
    const quoteWithoutOperationTime = {
      ...liveDetail,
      timestamp: null,
    }

    expect(
      shouldUseLiveCandle(
        quoteWithoutOperationTime,
        getArgentinaMarketStatus(openMarketNow),
        'live'
      )
    ).toBe(false)
    expect(
      mergeLiveQuoteIntoHistoricalSeries(
        [{ date: '2026-06-23', close: 7960 }],
        quoteWithoutOperationTime,
        {
          now: openMarketNow,
          quoteSource: 'live',
        }
      ).points
    ).toEqual([{ date: '2026-06-23', close: 7960 }])
  })

  it('does not trust demo or panel refresh timestamps', () => {
    const panelSnapshot = resolveCurrentStockQuote(
      {
        ...snapshot,
        quoteDate: '2026-06-24T14:30:00.000-03:00',
      },
      []
    )

    expect(
      shouldUseLiveCandle(
        liveDetail,
        getArgentinaMarketStatus(openMarketNow),
        'demo'
      )
    ).toBe(false)
    expect(
      shouldUseLiveCandle(
        panelSnapshot,
        getArgentinaMarketStatus(openMarketNow),
        'live'
      )
    ).toBe(false)
  })

  it('updates an existing OHLC candle without duplicating its date', () => {
    const result = mergeLiveQuoteIntoHistoricalSeries(
      [
        { date: '2026-06-23', close: 7960 },
        {
          date: '2026-06-24',
          open: 7800,
          high: 7900,
          low: 7600,
          close: 7850,
        },
      ],
      liveDetail,
      {
        now: openMarketNow,
        quoteSource: 'live',
      }
    )

    expect(result.points).toHaveLength(2)
    expect(result.points.at(-1)).toMatchObject({
      date: '2026-06-24',
      open: 7800,
      high: 7900,
      low: 7600,
      close: 7615,
    })
  })

  it('keeps the first observed realtime price as provisional open', () => {
    const quoteWithoutOpen = {
      ...liveDetail,
      open: null,
      high: null,
      low: null,
      price: 7700,
    }
    const firstMerge = mergeLiveQuoteIntoHistoricalSeries(
      [{ date: '2026-06-23', close: 7960 }],
      quoteWithoutOpen,
      {
        now: openMarketNow,
        quoteSource: 'live',
      }
    )
    const secondMerge = mergeLiveQuoteIntoHistoricalSeries(
      [{ date: '2026-06-23', close: 7960 }],
      { ...quoteWithoutOpen, price: 7750 },
      {
        now: openMarketNow,
        quoteSource: 'live',
        previousLiveCandle: firstMerge.liveSessionCandle,
      }
    )

    expect(secondMerge.liveSessionCandle).toMatchObject({
      open: 7700,
      high: 7750,
      low: 7700,
      close: 7750,
    })
  })
})

describe('syncHistoryWithCurrentQuote', () => {
  it('resolves full timestamps using the Argentina market date', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        quoteDate: '2026-06-25T01:30:00.000Z',
      },
      []
    )
    const result = syncHistoryWithCurrentQuote(
      [{ date: '2026-06-24', open: 991, high: 996, low: 989, close: 993.5 }],
      currentQuote
    )

    expect(result.points).toEqual([
      expect.objectContaining({ date: '2026-06-24', close: 994.5 }),
    ])
  })

  it('updates the latest same-day point with the current snapshot price', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        min: 990,
        max: 1000,
        quoteDate: '2026-06-24T20:00:00.000Z',
      },
      []
    )
    const result = syncHistoryWithCurrentQuote(
      [
        { date: '2026-06-23', close: 980 },
        { date: '2026-06-24', open: 991, high: 996, low: 989, close: 993.5 },
      ],
      currentQuote
    )

    expect(result.syncedQuote).toBe(true)
    expect(result.syncedAt).toBe('2026-06-24T20:00:00.000Z')
    expect(result.points.at(-1)).toMatchObject({
      date: '2026-06-24',
      close: 994.5,
      open: 991,
      high: 1000,
      low: 989,
    })
  })

  it('updates candle close and expands high/low with the current quote', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 1005,
        min: 988,
        max: 1002,
        quoteDate: '2026-06-24T20:00:00.000Z',
      },
      []
    )
    const result = syncHistoryWithCurrentQuote(
      [{ date: '2026-06-24', open: 991, high: 996, low: 990, close: 993.5 }],
      currentQuote
    )

    expect(result.points).toEqual([
      expect.objectContaining({
        date: '2026-06-24',
        close: 1005,
        open: 991,
        high: 1005,
        low: 988,
      }),
    ])
  })

  it('does not overwrite history when the current quote is older', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        quoteDate: '2026-06-23T20:00:00.000Z',
      },
      []
    )
    const history = [
      { date: '2026-06-24', close: 993.5 },
    ]

    expect(syncHistoryWithCurrentQuote(history, currentQuote)).toEqual({
      points: history,
      syncedAt: null,
      syncedQuote: false,
    })
  })

  it('does not append a new candle when the quote has no reliable OHLC data', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        open: null,
        min: null,
        max: null,
        quoteDate: '2026-06-24T20:00:00.000Z',
      },
      []
    )
    const history = [{ date: '2026-06-23', close: 980 }]

    expect(syncHistoryWithCurrentQuote(history, currentQuote)).toEqual({
      points: history,
      syncedAt: null,
      syncedQuote: false,
    })
  })

  it('appends a new point when current quote has a reliable OHLC set', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        open: 991,
        min: 990,
        max: 1000,
        quoteDate: '2026-06-24T20:00:00.000Z',
      },
      []
    )
    const result = syncHistoryWithCurrentQuote(
      [{ date: '2026-06-23', close: 980 }],
      currentQuote
    )

    expect(result.points).toEqual([
      { date: '2026-06-23', close: 980 },
      expect.objectContaining({
        date: '2026-06-24',
        open: 991,
        high: 1000,
        low: 990,
        close: 994.5,
      }),
    ])
  })

  it('creates the first historical point from a reliable current quote', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        open: 991,
        min: 990,
        max: 1000,
        quoteDate: '2026-06-24T20:00:00.000Z',
      },
      []
    )

    expect(syncHistoryWithCurrentQuote([], currentQuote)).toEqual({
      points: [
        expect.objectContaining({
          date: '2026-06-24',
          open: 991,
          high: 1000,
          low: 990,
          close: 994.5,
        }),
      ],
      syncedAt: '2026-06-24T20:00:00.000Z',
      syncedQuote: true,
    })
  })

  it('keeps history unchanged when there is no valid current quote', () => {
    const history = [
      { date: '2026-06-22', close: 970, volume: 100 },
      { date: '2026-06-23', close: 980, volume: 200 },
    ]
    const unavailableQuote = resolveCurrentStockQuote(
      { ...snapshot, price: null, var: null },
      []
    )

    expect(syncHistoryWithCurrentQuote(history, unavailableQuote)).toEqual({
      points: history,
      syncedAt: null,
      syncedQuote: false,
    })
  })

  it('preserves unaffected history and chronological order when appending', () => {
    const history = [
      { date: '2026-06-23', close: 980, volume: 200 },
      { date: '2026-06-22', close: 970, volume: 100 },
    ]
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        open: 991,
        min: 990,
        max: 1000,
        quoteDate: '2026-06-24T20:00:00.000Z',
      },
      []
    )
    const result = syncHistoryWithCurrentQuote(history, currentQuote)

    expect(result.points).toEqual([
      { date: '2026-06-22', close: 970, volume: 100 },
      { date: '2026-06-23', close: 980, volume: 200 },
      expect.objectContaining({ date: '2026-06-24', close: 994.5 }),
    ])
  })

  it('deduplicates and sorts history before syncing', () => {
    const currentQuote = resolveCurrentStockQuote(
      {
        ...snapshot,
        price: 994.5,
        quoteDate: '2026-06-24T20:00:00.000Z',
      },
      []
    )
    const result = syncHistoryWithCurrentQuote(
      [
        { date: '2026-06-24', close: 990 },
        { date: '2026-02-30', close: 9999 },
        { date: '2026-99-99', close: 9998 },
        { date: '2026-06-22', close: 970 },
        { date: '2026-06-23', close: 980 },
        { date: '2026-06-24', close: 993.5, high: 996, low: 989 },
      ],
      currentQuote
    )

    expect(result.points.map((point) => point.date)).toEqual([
      '2026-06-22',
      '2026-06-23',
      '2026-06-24',
    ])
    expect(result.points.at(-1)?.close).toBe(994.5)
    expect(new Set(result.points.map((point) => point.date)).size).toBe(
      result.points.length
    )
  })
})
