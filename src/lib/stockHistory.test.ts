import { describe, expect, it } from 'vitest'
import {
  isStockHistoryPoint,
  isStockHistoryRange,
  normalizeStockHistoryData,
  normalizeStockHistoryDataResult,
} from './stockHistory'

describe('stock history normalization', () => {
  it('applies decimal policies to OHLC and grouped policies only to quantities', () => {
    expect(normalizeStockHistoryData([{
      fecha: '2026-05-07', ultimoPrecio: '1.234', apertura: '0.123',
      maximo: '1.234', minimo: '-0.123', cierreAnterior: '0.000',
      variacion: '0.123', montoOperado: '1.234', precioPromedio: '1.234',
      volumen: '1.234', cantidadOperaciones: '1,234', interesesAbiertos: '1.234',
      laminaMinima: '1.234', lote: '1.234',
      puntas: [{ cantidadCompra: '1.234', precioCompra: '0.123', precioVenta: '1.234', cantidadVenta: '1,234' }],
    }])[0]).toMatchObject({
      close: 1.234, open: 0.123, high: 1.234, low: -0.123, previousClose: 0,
      dailyVariation: 0.123, amountTraded: 1.234, averagePrice: 1.234,
      volume: 1234, operationCount: 1234, openInterest: 1234, minimumSheet: 1234, lot: 1234,
      bid: { buyQuantity: 1234, buyPrice: 0.123, sellPrice: 1.234, sellQuantity: 1234 },
    })
  })

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
    ).toEqual({
      data: [{ date: '2026-05-07', close: 101 }],
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
    ).toEqual({
      data: [
        { date: '2024-02-29', close: 101 },
        { date: '2026-01-01', close: 102 },
        { date: '2026-12-31', close: 103 },
      ],
      discardedPoints: 3,
      totalPoints: 3,
    })
  })

  it('deduplicates valid dates before sorting and keeps the last payload row', () => {
    const result = normalizeStockHistoryDataResult([
      { fecha: '2026-05-08', ultimoPrecio: 108 },
      { fecha: '2026-05-07', ultimoPrecio: 101 },
      { fecha: '2026-05-08', ultimoPrecio: 109 },
      { fecha: '2026-05-06', ultimoPrecio: 99 },
      { fecha: '2026-05-08', ultimoPrecio: 110, volumen: 3000 },
      { fecha: '2026-05-07', ultimoPrecio: 102 },
    ])

    expect(result).toEqual({
      data: [
        { date: '2026-05-06', close: 99 },
        { date: '2026-05-07', close: 102 },
        { date: '2026-05-08', close: 110, volume: 3000 },
      ],
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
    ).toEqual({
      data: [{ date: '2026-05-07', close: 101 }],
      discardedPoints: 1,
      totalPoints: 1,
    })
  })

  it('preserves valid unique payloads without changing their values', () => {
    const payload = [
      { fecha: '2026-05-08', ultimoPrecio: 108, volumen: 2000 },
      { fecha: '2026-05-07', ultimoPrecio: 101, apertura: 100 },
    ]

    expect(normalizeStockHistoryDataResult(payload)).toEqual({
      data: [
        { date: '2026-05-07', close: 101, open: 100 },
        { date: '2026-05-08', close: 108, volume: 2000 },
      ],
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
