import { describe, expect, it } from 'vitest'
import {
  buildStockQuoteApiPath,
  normalizeStockQuoteDetail,
} from './stockQuote'

describe('stockQuote', () => {
  it('normalizes Cotizacion T1 with requested identity fallbacks and nominal volume', () => {
    const detail = normalizeStockQuoteDetail(
      {
        ultimoPrecio: 5100,
        variacion: -1.25,
        apertura: 5200,
        maximo: 5205,
        minimo: 5080,
        fechaHora: '2026-09-24T16:34:32-03:00',
        cierreAnterior: 5165,
        montoOperado: 3916378045,
        volumenNominal: 761696,
        cantidadOperaciones: 3079,
        descripcionTitulo: 'Pampa Energía',
        plazo: 'T1',
        laminaMinima: 1,
        lote: 1,
      },
      'PAMP',
      'bCBA'
    )

    expect(detail).toMatchObject({
      symbol: 'PAMP',
      market: 'bCBA',
      description: 'Pampa Energía',
      price: 5100,
      open: 5200,
      high: 5205,
      low: 5080,
      timestamp: '2026-09-24T16:34:32-03:00',
      previousClose: 5165,
      amountTraded: 3916378045,
      volume: 761696,
      operationCount: 3079,
      settlement: 'T1',
      minimumSheet: 1,
      lot: 1,
      minimumQuantity: null,
    })
    expect(detail.variation).toBeCloseTo(-1.2584704743, 10)
  })

  it('normalizes CotizacionDetalle and preserves every depth row and zero', () => {
    const detail = normalizeStockQuoteDetail(
      {
        ultimoPrecio: 7615,
        variacion: -4.33,
        cierreAnterior: 7960,
        simbolo: 'GGAL',
        mercado: 'bcba',
        descripcionTitulo: 'Grupo Financiero Galicia S.A',
        montoOperado: 20190703365,
        cantidadOperaciones: 8864,
        puntas: [
          {
            cantidadCompra: 1,
            precioCompra: 7500,
            precioVenta: 8050,
            cantidadVenta: 85,
          },
          {
            cantidadCompra: 0,
            precioCompra: 0,
            precioVenta: 8540,
            cantidadVenta: 24,
          },
        ],
      },
      'GGAL'
    )

    expect(detail.previousClose).toBe(7960)
    expect(detail.amountTraded).toBe(20190703365)
    expect(detail.operationCount).toBe(8864)
    expect(detail.depth).toHaveLength(2)
    expect(detail.depth[1]).toMatchObject({
      buyQuantity: 0,
      buyPrice: 0,
    })
  })

  it('uses the first informed nominal volume alias and ignores zero placeholders', () => {
    expect(
      normalizeStockQuoteDetail({
        ultimoPrecio: 1028,
        simbolo: 'ALUA',
        volumenNominal: 0,
        volumenNominalOperado: 164867,
      }).volume
    ).toBe(164867)

    expect(
      normalizeStockQuoteDetail({
        ultimoPrecio: 1028,
        simbolo: 'ALUA',
        volumenNominal: 0,
      }).volume
    ).toBeNull()
  })

  it('builds the internal BFF path', () => {
    expect(buildStockQuoteApiPath('GGAL')).toBe(
      '/api/stocks/GGAL/quote?market=bCBA'
    )
  })
})
