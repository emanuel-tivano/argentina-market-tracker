import { describe, expect, it } from 'vitest'
import {
  buildStockHistoryApiPath,
  deriveStockHistoryDailyPerformance,
  STOCK_HISTORY_RANGES,
  isStockHistoryPoint,
  isStockHistoryRange,
  normalizeStockHistoryData,
  normalizeStockHistoryDataResult,
} from './stockHistory'

describe('stock history normalization', () => {
  it('derives daily performance from consecutive consolidated closes', () => {
    const raw = [
      {
        fecha: '2026-09-21',
        ultimoPrecio: 6680,
        variacion: 0,
        cierreAnterior: 0,
        apertura: 6700,
        maximo: 6750,
        minimo: 6650,
        volumenNominal: 1000,
        montoOperado: 6680000,
      },
      {
        fecha: '2026-09-22',
        ultimoPrecio: 6640,
        variacion: 99,
        cierreAnterior: 1234,
        apertura: 6675,
        maximo: 6690,
        minimo: 6600,
        volumenNominal: 1100,
        montoOperado: 7304000,
      },
      {
        fecha: '2026-09-23',
        ultimoPrecio: 6445,
        variacion: 0,
        cierreAnterior: 0,
        apertura: 6600,
        maximo: 6620,
        minimo: 6400,
        volumenNominal: 1200,
        montoOperado: 7734000,
      },
    ]
    const normalized = normalizeStockHistoryDataResult(raw)
    const result = deriveStockHistoryDailyPerformance(normalized.data)

    expect(result[0]).not.toHaveProperty('previousClose')
    expect(result[0]).not.toHaveProperty('dailyVariation')
    expect(result[1]).toMatchObject({
      date: '2026-09-22',
      close: 6640,
      previousClose: 6680,
      open: 6675,
      high: 6690,
      low: 6600,
      volume: 1100,
      amountTraded: 7304000,
    })
    expect(result[1].dailyVariation).toBeCloseTo(-0.5988023952, 10)
    expect(result[2]).toMatchObject({
      date: '2026-09-23',
      close: 6445,
      previousClose: 6640,
    })
    expect(result[2].dailyVariation).toBeCloseTo(-2.936746988, 10)
    const withoutPerformance = (point: (typeof result)[number]) => {
      const sanitizedPoint = { ...point }

      delete sanitizedPoint.dailyVariation
      delete sanitizedPoint.previousClose

      return sanitizedPoint
    }
    expect(result.map(withoutPerformance)).toEqual(
      normalized.data.map(withoutPerformance)
    )
    expect(normalized).toMatchObject({
      invalidPoints: 0,
      duplicatePoints: 0,
      discardedPoints: 0,
      totalPoints: 3,
    })
  })

  it('derives only after selecting the definitive snapshot for each day', () => {
    const raw = [
      { fechaHora: '2026-09-21T17:00:00', ultimoPrecio: 100 },
      { fechaHora: '2026-09-22T11:00:00', ultimoPrecio: 105 },
      { fechaHora: '2026-09-22T17:00:00', ultimoPrecio: 110 },
      { fechaHora: '2026-09-23T17:00:00', ultimoPrecio: 121 },
    ]
    const derive = (input: typeof raw) => {
      const normalized = normalizeStockHistoryDataResult(input)

      return {
        ...normalized,
        data: deriveStockHistoryDailyPerformance(normalized.data),
      }
    }
    const result = derive(raw)

    expect(result).toEqual(derive([...raw].reverse()))
    expect(result).toMatchObject({
      data: [
        { date: '2026-09-21', close: 100 },
        {
          date: '2026-09-22',
          close: 110,
          previousClose: 100,
        },
        {
          date: '2026-09-23',
          close: 121,
          previousClose: 110,
        },
      ],
      invalidPoints: 0,
      duplicatePoints: 1,
      discardedPoints: 1,
      totalPoints: 3,
    })
    expect(result.data[1].dailyVariation).toBeCloseTo(10, 12)
    expect(result.data[2].dailyVariation).toBeCloseTo(10, 12)
  })

  it('fails closed on suspicious adjacent-session price transitions', () => {
    const result = deriveStockHistoryDailyPerformance([
      {
        date: '2026-09-22',
        close: 100,
        dailyVariation: 7,
        previousClose: 90,
      },
      {
        date: '2026-09-23',
        close: 200,
        dailyVariation: 100,
        previousClose: 100,
      },
    ])

    expect(result[0]).toEqual({ date: '2026-09-22', close: 100 })
    expect(result[1]).toEqual({
      date: '2026-09-23',
      close: 200,
      previousClose: 100,
    })
  })

  it('separates invalid rows from duplicate valid snapshots and chooses the latest time', () => {
    const latest = { fechaHora: '2022-05-17T17:00:03.007', ultimoPrecio: 100, apertura: 98, maximo: 102, minimo: 97, volumenNominal: 800, montoOperado: 80000 }
    const early = {
      ...latest,
      fechaHora: '2022-05-17T11:00:09.243',
      apertura: 97,
      maximo: 101,
      minimo: 96,
      volumenNominal: 0,
      montoOperado: 0,
    }
    const payload = [latest, { fecha: 'invalid', ultimoPrecio: 100 }, early]
    const result = normalizeStockHistoryDataResult(payload)
    expect(result).toMatchObject({ invalidPoints: 1, duplicatePoints: 1, discardedPoints: 2, totalPoints: 1 })
    expect(result.data).toEqual(normalizeStockHistoryData([latest]))
    expect(result.diagnostics).toMatchObject({
      ambiguousDuplicatePoints: 0,
      conflictingDuplicatePoints: 1,
      duplicateTradingDays: 1,
      maxMultiplicity: 2,
      recordsFetched: 3,
      validRecords: 2,
    })
    expect(normalizeStockHistoryDataResult([...payload].reverse())).toEqual(result)
    expect(normalizeStockHistoryDataResult([latest, early])).toMatchObject({ invalidPoints: 0, duplicatePoints: 1 })
  })

  it('compares explicitly zoned snapshot timestamps by instant rather than text', () => {
    const later = { fechaHora: '2026-05-07T15:00:00-03:00', ultimoPrecio: 105 }
    const earlier = { fechaHora: '2026-05-07T17:00:00Z', ultimoPrecio: 100 }
    expect(normalizeStockHistoryData([later, earlier])).toEqual(normalizeStockHistoryData([later]))
  })

  it('maps explicitly zoned timestamps to the Argentina trading date', () => {
    const result = normalizeStockHistoryDataResult([
      { fechaHora: '2026-05-08T01:30:00Z', ultimoPrecio: 100 },
      { fechaHora: '2026-05-07T22:45:00-03:00', ultimoPrecio: 105 },
    ])

    expect(result).toMatchObject({
      data: [{ date: '2026-05-07', close: 105 }],
      duplicatePoints: 1,
      invalidPoints: 0,
    })
  })

  it.each([
    [undefined, '2026-05-07T17:00:00'],
    ['invalid', '2026-05-07T17:00:00'],
    ['2026-05-07T25:00:00', '2026-05-07T17:00:00'],
    ['2026-05-07T18:00:00Z', '2026-05-07T17:00:00'],
    ['2026-05-08T18:00:00', '2026-05-07T17:00:00'],
    ['2026-05-07T17:00:00', '2026-05-07T17:00:00'],
  ])('omits conflicting rows when chronology is ambiguous (%s, %s)', (first, last) => {
    const points = [
      { date: '2026-05-07', timestamp: first, close: 101 },
      { date: '2026-05-07', timestamp: last, close: 102 },
    ]
    expect(normalizeStockHistoryDataResult(points)).toMatchObject({
      data: [],
      diagnostics: {
        ambiguousDuplicatePoints: 2,
        conflictingDuplicatePoints: 1,
        omittedTradingDays: 1,
      },
      invalidPoints: 2,
      duplicatePoints: 0,
    })
  })

  it.each([2, 3])('consolidates %i identical rows without inventing a winner', (count) => {
    const row = {
      fecha: '2026-05-07',
      ultimoPrecio: 101,
      apertura: 100,
      maximo: 102,
      minimo: 99,
      volumenNominal: 1000,
    }
    const result = normalizeStockHistoryDataResult(
      Array.from({ length: count }, () => ({ ...row }))
    )

    expect(result).toMatchObject({
      data: [{ date: '2026-05-07', close: 101 }],
      diagnostics: {
        conflictingDuplicatePoints: 0,
        duplicateTradingDays: 1,
        identicalDuplicatePoints: count - 1,
        maxMultiplicity: count,
      },
      duplicatePoints: count - 1,
      invalidPoints: 0,
      totalPoints: 1,
    })
  })

  it('consolidates an inclusive boundary repeated across fetched pages', () => {
    const firstPage = [
      { fecha: '2026-05-06', ultimoPrecio: 100 },
      { fecha: '2026-05-07', ultimoPrecio: 101 },
    ]
    const secondPage = [
      { fecha: '2026-05-07', ultimoPrecio: 101 },
      { fecha: '2026-05-08', ultimoPrecio: 102 },
    ]
    const result = normalizeStockHistoryDataResult([
      ...firstPage,
      ...secondPage,
    ])

    expect(result).toMatchObject({
      data: [
        { date: '2026-05-06', close: 100 },
        { date: '2026-05-07', close: 101 },
        { date: '2026-05-08', close: 102 },
      ],
      diagnostics: {
        conflictingDuplicatePoints: 0,
        duplicateTradingDays: 1,
        identicalDuplicatePoints: 1,
      },
      duplicatePoints: 1,
      totalPoints: 3,
    })
  })

  it('normalizes a synthetic five-year multi-page payload with inclusive boundaries', () => {
    const pageStarts = Array.from({ length: 5 }, (_, year) => 2021 + year)
    const pages = pageStarts.map((year) => [
      { fecha: `${year}-01-04`, ultimoPrecio: 100 + year },
      { fecha: `${year + 1}-01-04`, ultimoPrecio: 101 + year },
    ])
    const result = normalizeStockHistoryDataResult(pages.flat())

    expect(result.data).toHaveLength(6)
    expect(result.duplicatePoints).toBe(4)
    expect(new Set(result.data.map((point) => point.date)).size).toBe(6)
    expect(result.data.every((point, index) =>
      index === 0 || result.data[index - 1].date < point.date
    )).toBe(true)
  })

  it('preserves all available sessions in a long series with many intraday snapshots', () => {
    // Synthetic shape matching the diagnosed issue, never a captured live payload.
    const daily = Array.from({ length: 1250 }, (_, index) => {
      const day = new Date(Date.UTC(2021, 0, index + 1))
      return { fechaHora: `${day.toISOString().slice(0, 10)}T17:00:00`, ultimoPrecio: 100, apertura: 99, maximo: 102, minimo: 98 }
    }).filter(row => ![0, 6].includes(new Date(row.fechaHora + 'Z').getUTCDay()))
    const snapshots = Array.from({ length: 1374 }, (_, index) => ({
      ...daily[0], fechaHora: `${daily[0].fechaHora.slice(0, 10)}T11:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
    }))
    const payload = [...daily, ...snapshots, { fecha: '2026-02-30', ultimoPrecio: 100 }]
    const result = normalizeStockHistoryDataResult(payload)
    expect(result).toMatchObject({ invalidPoints: 1, duplicatePoints: snapshots.length, totalPoints: daily.length })
    expect(result.data).toEqual(normalizeStockHistoryData(daily))
    expect(result).toEqual(normalizeStockHistoryDataResult([...payload].reverse()))
    expect(result.data.every((point, index) => isStockHistoryPoint(point) &&
      point.low! <= Math.min(point.open!, point.close) && point.high! >= Math.max(point.open!, point.close) &&
      (index === 0 || result.data[index - 1].date < point.date))).toBe(true)
    expect(new Set(result.data.map(point => point.date)).size).toBe(daily.length)
  })

  it.each(STOCK_HISTORY_RANGES)('accepts and builds the API path for %s', (range) => {
    expect(isStockHistoryRange(range)).toBe(true)
    expect(buildStockHistoryApiPath('ALUA', range, 'bCBA')).toBe(
      `/api/stocks/ALUA/history?range=${range}&market=bCBA`
    )
  })

  it('applies decimal policies to OHLC and grouped policies only to quantities', () => {
    const point = normalizeStockHistoryData([{
      fecha: '2026-05-07', ultimoPrecio: '1.234', apertura: '0.123',
      maximo: '1.234', minimo: '-0.123', cierreAnterior: '0.000',
      variacion: '0.123', montoOperado: '1.234', precioPromedio: '1.234',
      volumen: '1.234', cantidadOperaciones: '1,234', interesesAbiertos: '1.234',
      laminaMinima: '1.234', lote: '1.234',
      puntas: [{ cantidadCompra: '1.234', precioCompra: '0.123', precioVenta: '1.234', cantidadVenta: '1,234' }],
    }])[0]
    expect(point).toMatchObject({
      close: 1.234, open: 0.123, high: 1.234,
      dailyVariation: 0.123, amountTraded: 1.234, averagePrice: 1.234,
      volume: 1234, operationCount: 1234, openInterest: 1234, minimumSheet: 1234, lot: 1234,
      bid: { buyQuantity: 1234, buyPrice: 0.123, sellPrice: 1.234, sellQuantity: 1234 },
    })
    expect(point).not.toHaveProperty('low')
    expect(point).not.toHaveProperty('previousClose')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, null])(
    'discards impossible close values (%s)',
    (close) => {
      expect(
        normalizeStockHistoryDataResult([
          { fecha: '2026-05-07', ultimoPrecio: close },
          { fecha: '2026-05-08', ultimoPrecio: 100 },
        ])
      ).toMatchObject({
        data: [{ date: '2026-05-08', close: 100 }],
        invalidPoints: 1,
      })
    }
  )

  it.each(['abc123', '1e3', '12.34.56', '$ 123.45'])('discards malformed prices %s without stripping characters', (price) => {
    expect(normalizeStockHistoryDataResult([
      { fecha: '2026-05-07', ultimoPrecio: price },
      { fecha: '2026-05-08', ultimoPrecio: '1,234.56' },
    ])).toMatchObject({ data: [{ date: '2026-05-08', close: 1234.56 }], discardedPoints: 1 })
  })

  it('normalizes known IOL-style field names into stable history points', () => {
    expect(
      normalizeStockHistoryData({
        cotizaciones: [
          {
            fecha: '2026-05-07T00:00:00',
            ultimoPrecio: 101,
            apertura: 98,
            maximo: 102,
            minimo: 97,
            volumen: 1000,
          },
        ],
      })
    ).toEqual([
      {
        date: '2026-05-07',
        close: 101,
        open: 98,
        high: 102,
        low: 97,
        volume: 1000,
      },
    ])
  })

  it('preserves the extended IOL quote fields on historical points', () => {
    expect(
      normalizeStockHistoryData([
        {
          ultimoPrecio: 1028,
          variacion: 6.25,
          apertura: 990,
          maximo: 1040,
          minimo: 985,
          fechaHora: '2026-06-24T20:39:47.208Z',
          cierreAnterior: 967.5,
          montoOperado: 2500000,
          volumenNominal: 2400,
          precioPromedio: 1012.5,
          moneda: 'peso_Argentino',
          interesesAbiertos: 15,
          puntas: [
            {
              cantidadCompra: 20,
              precioCompra: 1027,
              precioVenta: 1029,
              cantidadVenta: 18,
            },
          ],
          cantidadOperaciones: 42,
          descripcionTitulo: 'Aluar',
          plazo: '48hs',
          laminaMinima: 1,
          lote: 1,
        },
      ])
    ).toEqual([
      {
        date: '2026-06-24',
        timestamp: '2026-06-24T20:39:47.208Z',
        close: 1028,
        dailyVariation: 6.25,
        open: 990,
        high: 1040,
        low: 985,
        previousClose: 967.5,
        amountTraded: 2500000,
        volume: 2400,
        averagePrice: 1012.5,
        currency: 'peso_Argentino',
        openInterest: 15,
        operationCount: 42,
        description: 'Aluar',
        settlement: '48hs',
        minimumSheet: 1,
        lot: 1,
        bid: {
          buyQuantity: 20,
          buyPrice: 1027,
          sellPrice: 1029,
          sellQuantity: 18,
        },
      },
    ])
  })

  it('normalizes alternate CEDEAR-style price fields from IOL', () => {
    expect(
      normalizeStockHistoryData([
        {
          fechaCotizacion: '2026-05-07T00:00:00',
          precio: 916,
          precioApertura: 900,
          precioMaximo: 920,
          precioMinimo: 890,
          volumenNominal: 1500,
        },
      ])
    ).toEqual([
      {
        date: '2026-05-07',
        close: 916,
        open: 900,
        high: 920,
        low: 890,
        volume: 1500,
      },
    ])
  })

  it('normalizes volumenNominalOperado from historical payloads', () => {
    expect(
      normalizeStockHistoryData([
        {
          fecha: '2026-05-07',
          ultimoPrecio: 1028,
          volumenNominalOperado: 164867,
        },
      ])
    ).toEqual([
      {
        date: '2026-05-07',
        close: 1028,
        volume: 164867,
      },
    ])
  })

  it('normalizes CEDEAR rows with local date and numeric string values', () => {
    expect(
      normalizeStockHistoryData({
        Data: [
          {
            Fecha: '07/05/2026',
            PrecioAjustado: '1.234,56',
            PrecioApertura: '1.200,00',
            PrecioMaximo: '1.250,10',
            PrecioMinimo: '1.190,50',
            VolumenNominal: '1.500',
          },
        ],
      })
    ).toEqual([
      {
        date: '2026-05-07',
        close: 1234.56,
        open: 1200,
        high: 1250.1,
        low: 1190.5,
        volume: 1500,
      },
    ])
  })

  it('matches history field names case-insensitively without changing actions', () => {
    expect(
      normalizeStockHistoryData([
        {
          FECHA_HORA: '2026-05-07T00:00:00',
          ULTIMO_PRECIO: '101,25',
          APERTURA: '98,00',
          MAXIMO: '102,50',
          MINIMO: '97,75',
          VOLUMEN: '2,000',
        },
      ])
    ).toEqual([
      {
        date: '2026-05-07',
        timestamp: '2026-05-07T00:00:00',
        close: 101.25,
        open: 98,
        high: 102.5,
        low: 97.75,
        volume: 2000,
      },
    ])
  })

  it('filters partially invalid rows and keeps valid history points', () => {
    expect(
      normalizeStockHistoryDataResult([
        { fecha: 'invalid', ultimoPrecio: 100 },
        { fecha: '2026-05-07', ultimoPrecio: 101 },
      ])
    ).toMatchObject({
      data: [{ date: '2026-05-07', close: 101 }],
      invalidPoints: 1,
      duplicatePoints: 0,
      discardedPoints: 1,
      totalPoints: 1,
    })
  })

  it('discards impossible calendar dates before sorting and counting points', () => {
    expect(
      normalizeStockHistoryDataResult([
        { fecha: '2026-12-31', ultimoPrecio: 103 },
        { fecha: '2026-99-99', ultimoPrecio: 999 },
        { fecha: '2026-02-30T00:00:00Z', ultimoPrecio: 998 },
        { fecha: '2024-02-29', ultimoPrecio: 101 },
        { fecha: '2025-04-31', ultimoPrecio: 997 },
        { fecha: '2026-01-01', ultimoPrecio: 102 },
      ])
    ).toMatchObject({
      data: [
        { date: '2024-02-29', close: 101 },
        { date: '2026-01-01', close: 102 },
        { date: '2026-12-31', close: 103 },
      ],
      invalidPoints: 3,
      duplicatePoints: 0,
      discardedPoints: 3,
      totalPoints: 3,
    })
  })

  it('deduplicates non-consecutive unordered dates using the latest snapshot', () => {
    const result = normalizeStockHistoryDataResult([
      { fechaHora: '2026-05-08T10:00:00', ultimoPrecio: 108 },
      { fechaHora: '2026-05-07T10:00:00', ultimoPrecio: 101 },
      { fechaHora: '2026-05-08T12:00:00', ultimoPrecio: 109 },
      { fecha: '2026-05-06', ultimoPrecio: 99 },
      { fechaHora: '2026-05-08T17:00:00', ultimoPrecio: 110, volumen: 3000 },
      { fechaHora: '2026-05-07T17:00:00', ultimoPrecio: 102 },
    ])

    expect(result).toMatchObject({
      data: [
        { date: '2026-05-06', close: 99 },
        { date: '2026-05-07', timestamp: '2026-05-07T17:00:00', close: 102 },
        { date: '2026-05-08', timestamp: '2026-05-08T17:00:00', close: 110, volume: 3000 },
      ],
      invalidPoints: 0,
      duplicatePoints: 3,
      discardedPoints: 3,
      totalPoints: 3,
    })
    expect(result.totalPoints).toBe(result.data.length)
    expect(new Set(result.data.map((point) => point.date)).size).toBe(
      result.data.length
    )
  })

  it('does not let an invalid duplicate displace the last valid point', () => {
    expect(
      normalizeStockHistoryDataResult([
        { fecha: '2026-05-07', ultimoPrecio: 101 },
        { fecha: '2026-05-07', ultimoPrecio: 'invalid' },
      ])
    ).toMatchObject({
      data: [{ date: '2026-05-07', close: 101 }],
      invalidPoints: 1,
      duplicatePoints: 0,
      discardedPoints: 1,
      totalPoints: 1,
    })
  })

  it('preserves valid unique payloads without changing their values', () => {
    const payload = [
      { fecha: '2026-05-08', ultimoPrecio: 108, volumen: 2000 },
      { fecha: '2026-05-07', ultimoPrecio: 101, apertura: 100 },
    ]

    expect(normalizeStockHistoryDataResult(payload)).toMatchObject({
      data: [
        { date: '2026-05-07', close: 101, open: 100 },
        { date: '2026-05-08', close: 108, volume: 2000 },
      ],
      invalidPoints: 0,
      duplicatePoints: 0,
      discardedPoints: 0,
      totalPoints: 2,
    })
  })

  it('uses the same calendar rule in the shared history contract', () => {
    expect(isStockHistoryPoint({ date: '2026-02-28', close: 100 })).toBe(true)
    expect(isStockHistoryPoint({ date: '2026-02-30', close: 100 })).toBe(false)
    expect(isStockHistoryPoint({ date: '2026-99-99', close: 100 })).toBe(false)
  })

  it('throws when no valid history item remains', () => {
    expect(() => normalizeStockHistoryData([{ fecha: 'invalid' }])).toThrow(
      'Upstream history payload contains no valid items'
    )
  })

  it('throws when a row is missing required fields', () => {
    expect(() =>
      normalizeStockHistoryData([{ ultimoPrecio: 101 }])
    ).toThrow('Upstream history payload contains no valid items')
  })

  it('throws when a payload has incorrect required field types', () => {
    expect(() =>
      normalizeStockHistoryData([{ fecha: '2026-05-07', ultimoPrecio: {} }])
    ).toThrow('Upstream history payload contains no valid items')
  })

  it('keeps ranges explicit', () => {
    expect(isStockHistoryRange('1M')).toBe(true)
    expect(isStockHistoryRange('2Y')).toBe(false)
  })
})
