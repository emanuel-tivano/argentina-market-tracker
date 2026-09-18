import { describe, expect, it } from 'vitest'
import {
  calculateDailyQuoteMetrics,
  calculatePeriodMetrics,
  getLatestHistoryQuotes,
  hasSufficientCandles,
  mergeTodayQuoteIntoHistory,
  normalizeCurrentStockQuote,
  normalizeCandles,
  normalizeHistoryPoints,
  toMarketDateString,
} from './advancedStockChart'

describe('advancedStockChart helpers', () => {
  it('normalizes the real IOL array quote shape', () => {
    expect(
      normalizeCurrentStockQuote([
        {
          ultimoPrecio: 967.5,
          variacion: 3.09,
          apertura: 948,
          maximo: 970.5,
          minimo: 920,
          fechaHora: '2026-06-24T00:06:03.521Z',
          cierreAnterior: 938.5,
          volumenNominal: 407493,
        },
      ])
    ).toEqual({
      close: 967.5,
      open: 948,
      high: 970.5,
      low: 920,
      volume: 407493,
      date: '2026-06-23',
      previousClose: 938.5,
      dailyVariation: 3.09,
    })
  })

  it('selects the latest two valid positive-price history points', () => {
    expect(
      getLatestHistoryQuotes([
        { date: '2026-06-24', close: 0 },
        { date: 'invalid', close: 999 },
        { date: '2026-06-22', close: 100 },
        { date: '2026-06-25', close: Number.NaN },
        { date: '2026-06-23', close: 110 },
      ])
    ).toEqual({
      latestHistoricalPoint: { date: '2026-06-23', close: 110 },
      previousHistoricalPoint: { date: '2026-06-22', close: 100 },
    })
  })

  it('falls back to the prior valid close and calculates daily variation', () => {
    const metrics = calculateDailyQuoteMetrics(
        {
          date: '2026-06-23',
          close: 110,
          previousClose: 0,
          dailyVariation: 0,
        },
        { date: '2026-06-22', close: 100 }
      )
    expect(metrics.previousClose).toBe(100)
    expect(metrics.dailyVariation).toBeCloseTo(10, 12)
  })

  it('keeps a real zero daily variation when current and previous close match', () => {
    expect(
      calculateDailyQuoteMetrics(
        {
          date: '2026-06-23',
          close: 100,
          previousClose: 0,
          dailyVariation: 0,
        },
        { date: '2026-06-22', close: 100 }
      )
    ).toEqual({
      previousClose: 100,
      dailyVariation: 0,
    })
  })

  it('does not present a split-like discontinuity as daily performance', () => {
    expect(
      calculateDailyQuoteMetrics(
        { date: '2026-08-03', close: 8105 },
        { date: '2026-07-31', close: 83000 }
      )
    ).toEqual({
      previousClose: 83000,
      dailyVariation: null,
    })
  })

  it('supports a direct IOL quote object and skips invalid array entries', () => {
    expect(
      normalizeCurrentStockQuote([
        { ultimoPrecio: 0 },
        {
          ultimoPrecio: '110.5',
          apertura: '108',
          maximo: '112',
          minimo: '107',
        },
      ])
    ).toEqual({
      close: 110.5,
      open: 108,
      high: 112,
      low: 107,
      volume: null,
      date: null,
      previousClose: null,
      dailyVariation: null,
    })

    expect(
      normalizeCurrentStockQuote({
        ultimoPrecio: 110,
        apertura: 108,
        maximo: 112,
        minimo: 107,
      })?.close
    ).toBe(110)
  })

  it('converts the IOL UTC timestamp to the Argentina market date', () => {
    expect(
      toMarketDateString(
        new Date('2026-06-24T00:06:03.521Z'),
        'America/Argentina/Buenos_Aires'
      )
    ).toBe('2026-06-23')
  })

  it('does not add a point for the all-zero IOL mock response', () => {
    const history = [{ date: '2026-06-22', close: 100 }]

    expect(
      mergeTodayQuoteIntoHistory(history, [
        {
          ultimoPrecio: 0,
          variacion: 0,
          apertura: 0,
          maximo: 0,
          minimo: 0,
          fechaHora: '2026-06-24T00:06:03.521Z',
          cierreAnterior: 0,
          volumenNominal: 0,
        },
      ])
    ).toEqual(history)
  })

  it('uses IOL quote date, previous close and safe high/low fallbacks', () => {
    expect(
      mergeTodayQuoteIntoHistory(
        [{ date: '2026-06-22', close: 100 }],
        {
          ultimoPrecio: 105,
          apertura: 0,
          maximo: 0,
          minimo: 0,
          cierreAnterior: 102,
          volumenNominal: 0,
          fechaHora: '2026-06-24T00:06:03.521Z',
        }
      )
    ).toEqual([
      { date: '2026-06-22', close: 100 },
      {
        date: '2026-06-23',
        close: 105,
        open: 102,
        high: 105,
        low: 102,
        volume: 0,
      },
    ])
  })

  it('uses the latest historical close when IOL open and previous close are invalid', () => {
    expect(
      mergeTodayQuoteIntoHistory(
        [{ date: '2026-06-22', close: 103 }],
        {
          ultimoPrecio: 101,
          apertura: 0,
          cierreAnterior: 0,
          maximo: null,
          minimo: null,
          fechaHora: '2026-06-24T00:06:03.521Z',
        }
      ).at(-1)
    ).toEqual({
      date: '2026-06-23',
      close: 101,
      open: 103,
      high: 103,
      low: 101,
    })
  })

  it('updates a matching older quote date but does not append a stale date', () => {
    const history = [
      { date: '2026-06-21', close: 99 },
      { date: '2026-06-23', close: 105 },
    ]
    const staleQuote = {
      ultimoPrecio: 101,
      apertura: 100,
      maximo: 102,
      minimo: 98,
      fechaHora: '2026-06-22T15:00:00.000Z',
    }

    expect(mergeTodayQuoteIntoHistory(history, staleQuote)).toEqual(history)

    expect(
      mergeTodayQuoteIntoHistory(
        [{ date: '2026-06-22', close: 100 }, ...history.slice(1)],
        staleQuote
      )[0]
    ).toEqual({
      date: '2026-06-22',
      close: 101,
      open: 100,
      high: 102,
      low: 98,
    })
  })

  it('does not create a dated point when the quote has no market timestamp', () => {
    expect(
      mergeTodayQuoteIntoHistory(
        [{ date: '2026-06-22', close: 100 }],
        {
          price: 110,
          open: 102,
          max: 112,
          min: 101,
          volume: 5000,
        }
      )
    ).toEqual([{ date: '2026-06-22', close: 100 }])
  })

  it('updates a matching quote date without duplicating it', () => {
    const result = mergeTodayQuoteIntoHistory(
      [
        { date: '2026-06-22', close: 100 },
        {
          date: '2026-06-23',
          close: 105,
          open: 101,
          high: 108,
          low: 99,
        },
      ],
      {
        price: 111,
        date: '2026-06-23',
        open: null,
        max: null,
        min: null,
        volume: 6000,
      }
    )

    expect(result).toHaveLength(2)
    expect(result.at(-1)).toEqual({
      date: '2026-06-23',
      close: 111,
      open: 101,
      high: 111,
      low: 99,
      volume: 6000,
    })
  })

  it('generates safe OHLC fallbacks from the previous close', () => {
    expect(
      mergeTodayQuoteIntoHistory(
        [{ date: '2026-06-22', close: 108 }],
        {
          price: 105,
          date: '2026-06-23',
          open: null,
          max: null,
          min: null,
          volume: null,
        }
      ).at(-1)
    ).toEqual({
      date: '2026-06-23',
      close: 105,
      open: 108,
      high: 108,
      low: 105,
    })
  })

  it('does not add today when the current price is invalid', () => {
    expect(
      mergeTodayQuoteIntoHistory(
        [{ date: '2026-06-22', close: 100 }],
        {
          price: Number.NaN,
          open: 101,
          max: 102,
          min: 99,
          volume: 1000,
        }
      )
    ).toEqual([{ date: '2026-06-22', close: 100 }])
  })

  it('normalizes duplicate dates and returns ascending order', () => {
    const result = mergeTodayQuoteIntoHistory(
      [
        { date: '2026-06-22T15:00:00.000Z', close: 101 },
        { date: '2026-06-21', close: 99 },
        { date: '2026-06-22', close: 102 },
      ],
      {
        price: 110,
        date: '2026-06-23',
        open: 103,
        max: 111,
        min: 102,
        volume: null,
      }
    )

    expect(result.map((point) => point.date)).toEqual([
      '2026-06-21',
      '2026-06-22',
      '2026-06-23',
    ])
    expect(result[1].close).toBe(102)
  })

  it('normalizes, sorts and deduplicates history points', () => {
    expect(
      normalizeHistoryPoints([
        { date: '2026-05-08', close: 103 },
        { date: 'invalid', close: 104 },
        { date: '2026-02-30', close: 999 },
        { date: '2026-99-99', close: 998 },
        { date: '2026-05-07', close: 100 },
        { date: '2026-05-08T00:00:00.000Z', close: 105 },
      ])
    ).toEqual([
      {
        date: '2026-05-07',
        time: Math.floor(Date.parse('2026-05-07') / 1000),
        close: 100,
      },
      {
        date: '2026-05-08',
        time: Math.floor(Date.parse('2026-05-08') / 1000),
        close: 105,
      },
    ])
  })

  it('keeps complete candles, repairs their bounds and filters partial OHLC', () => {
    const normalized = normalizeHistoryPoints([
      {
        date: '2026-05-07',
        open: 99,
        high: 102,
        low: 98,
        close: 101,
      },
      {
        date: '2026-05-08',
        open: 101,
        high: 100,
        low: 98,
        close: 103,
      },
      { date: '2026-05-09', close: 104 },
    ])

    expect(normalizeCandles(normalized)).toEqual([
      {
        time: Math.floor(Date.parse('2026-05-07') / 1000),
        open: 99,
        high: 102,
        low: 98,
        close: 101,
      },
      {
        time: Math.floor(Date.parse('2026-05-08') / 1000),
        open: 101,
        high: 103,
        low: 98,
        close: 103,
      },
    ])
  })

  it.each([
    ['3M', 65],
    ['6M', 130],
    ['1Y', 252],
  ])('keeps candles enabled for a valid %s range', (_range, pointCount) => {
    const rawPoints = Array.from({ length: pointCount }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, index + 1))
        .toISOString()
        .slice(0, 10)
      const close = 100 + index

      return {
        date,
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
      }
    })
    const normalized = normalizeHistoryPoints(rawPoints)
    const candles = normalizeCandles(normalized)

    expect(candles).toHaveLength(pointCount)
    expect(hasSufficientCandles(normalized, candles)).toBe(true)
  })

  it('accepts numeric OHLC strings and does not require volume', () => {
    const normalized = normalizeHistoryPoints([
      {
        date: '2026-05-07',
        open: '99.5',
        high: '103',
        low: '98,25',
        close: '101.75',
      },
      {
        date: '2026-05-08',
        open: '101',
        high: '105',
        low: '100',
        close: '104',
      },
    ])
    const candles = normalizeCandles(normalized)

    expect(candles).toEqual([
      {
        time: Math.floor(Date.parse('2026-05-07') / 1000),
        open: 99.5,
        high: 103,
        low: 98.25,
        close: 101.75,
      },
      {
        time: Math.floor(Date.parse('2026-05-08') / 1000),
        open: 101,
        high: 105,
        low: 100,
        close: 104,
      },
    ])
    expect(hasSufficientCandles(normalized, candles)).toBe(true)
  })

  it('filters a broken OHLC point without disabling a mostly valid series', () => {
    const normalized = normalizeHistoryPoints([
      { date: '2026-05-01', open: 99, high: 102, low: 98, close: 101 },
      { date: '2026-05-02', open: 101, high: 104, low: 100, close: 103 },
      { date: '2026-05-03', open: null, high: 105, low: 101, close: 104 },
      { date: '2026-05-04', open: 104, high: 107, low: 103, close: 106 },
    ])
    const candles = normalizeCandles(normalized)

    expect(candles).toHaveLength(3)
    expect(hasSufficientCandles(normalized, candles)).toBe(true)
  })

  it('falls back when valid OHLC coverage is insufficient', () => {
    const normalized = normalizeHistoryPoints([
      { date: '2026-05-01', open: 99, high: 102, low: 98, close: 101 },
      { date: '2026-05-02', close: 103 },
      { date: '2026-05-03', close: 104 },
      { date: '2026-05-04', close: 106 },
    ])
    const candles = normalizeCandles(normalized)

    expect(candles).toHaveLength(1)
    expect(hasSufficientCandles(normalized, candles)).toBe(false)
  })

  it('renders exactly one candle per trading day after resolving duplicate dates', () => {
    const normalized = normalizeHistoryPoints([
      {
        date: '2026-05-08T15:00:00.000Z',
        open: 102,
        high: 106,
        low: 101,
        close: 105,
      },
      {
        date: '2026-05-07',
        open: 99,
        high: 102,
        low: 98,
        close: 101,
      },
      {
        date: '2026-05-08',
        open: 103,
        high: 108,
        low: 102,
        close: 107,
      },
    ])

    expect(normalized.map((point) => point.date)).toEqual([
      '2026-05-07',
      '2026-05-08',
    ])
    expect(normalizeCandles(normalized).at(-1)?.close).toBe(107)
  })

  it('calculates period metrics with OHLCV fallbacks', () => {
    const normalized = normalizeHistoryPoints([
      {
        date: '2026-05-01',
        close: 100,
        high: 104,
        low: 98,
        volume: 1000,
      },
      {
        date: '2026-05-02',
        close: 110,
        high: 115,
        low: 105,
        volume: 3000,
      },
      { date: '2026-05-03', close: 120 },
    ])

    const metrics = calculatePeriodMetrics(normalized)
    expect(metrics).toMatchObject({
      currentPrice: 120,
      periodHigh: 120,
      periodLow: 98,
      averageVolume: 2000,
      highLowRange: 22,
      pointCount: 3,
    })
    expect(metrics?.periodVariation).toBeCloseTo(20, 12)
  })
})
