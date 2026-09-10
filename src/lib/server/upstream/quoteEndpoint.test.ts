import { describe, expect, it } from 'vitest'
import {
  getQuoteDetailEndpoint,
  getQuoteEndpoint,
  normalizeQuoteMarket,
} from './quoteEndpoint'

describe('quoteEndpoint', () => {
  it.each(['bCBA', 'BCBA', 'bcba', ' bCbA '])('uses the same canonical market for both resources: %s', (market) => {
    expect(getQuoteEndpoint(market, 'ALUA')).toBe('/api/v2/bCBA/Titulos/ALUA/Cotizacion')
    expect(getQuoteDetailEndpoint(market, 'ALUA')).toBe('/api/v2/bCBA/Titulos/ALUA/CotizacionDetalle')
  })

  it('encodes path segments and preserves other market names', () => {
    expect(getQuoteEndpoint(' NYSE ', 'A/B')).toBe('/api/v2/NYSE/Titulos/A%2FB/Cotizacion')
    expect(getQuoteDetailEndpoint(' NYSE ', 'A/B')).toBe('/api/v2/NYSE/Titulos/A%2FB/CotizacionDetalle')
  })
  it('builds the expected individual quote endpoint path', () => {
    expect(getQuoteEndpoint('bCBA', 'GGAL')).toBe(
      '/api/v2/bCBA/Titulos/GGAL/Cotizacion'
    )
  })

  it('normalizes BCBA market casing to the canonical path format', () => {
    expect(normalizeQuoteMarket('BCBA')).toBe('bCBA')
    expect(normalizeQuoteMarket('bcba')).toBe('bCBA')
    expect(getQuoteEndpoint('BCBA', 'ALUA')).toBe(
      '/api/v2/bCBA/Titulos/ALUA/Cotizacion'
    )
  })

  it('builds the CotizacionDetalle endpoint', () => {
    expect(getQuoteDetailEndpoint('bCBA', 'GGAL')).toBe(
      '/api/v2/bCBA/Titulos/GGAL/CotizacionDetalle'
    )
  })
})
