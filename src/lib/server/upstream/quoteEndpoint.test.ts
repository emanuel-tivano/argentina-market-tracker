import { describe, expect, it } from 'vitest'
import {
  getQuoteDetailEndpoint,
  getQuoteEndpoint,
  getQuoteT1Endpoint,
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

  it('builds the explicit Cotizacion T1 endpoint without sandbox credentials', () => {
    const endpoint = getQuoteT1Endpoint('BCBA', ' ggal ')
    const url = new URL(endpoint, 'https://api.example.test')

    expect(url.pathname).toBe('/api/v2/bCBA/Titulos/GGAL/Cotizacion')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      mercado: 'bcba',
      simbolo: 'GGAL',
      'model.simbolo': 'GGAL',
      'model.mercado': 'bCBA',
      'model.plazo': 't1',
    })
    expect(url.searchParams.has('api_key')).toBe(false)
  })

  it('encodes the normalized symbol in the T1 path and query', () => {
    const endpoint = getQuoteT1Endpoint(' bCbA ', ' a/b ')
    const url = new URL(endpoint, 'https://api.example.test')

    expect(url.pathname).toBe('/api/v2/bCBA/Titulos/A%2FB/Cotizacion')
    expect(url.searchParams.get('simbolo')).toBe('A/B')
    expect(url.searchParams.get('model.simbolo')).toBe('A/B')
    expect(url.searchParams.get('model.plazo')).toBe('t1')
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
