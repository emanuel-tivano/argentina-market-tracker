import 'server-only'

export function normalizeQuoteMarket(market: string): string {
  const trimmedMarket = market.trim()

  return trimmedMarket.toLowerCase() === 'bcba' ? 'bCBA' : trimmedMarket
}

export function getQuoteEndpoint(market: string, symbol: string): string {
  return `/api/v2/${encodeURIComponent(normalizeQuoteMarket(market))}/Titulos/${encodeURIComponent(
    symbol
  )}/Cotizacion`
}

export function getQuoteT1Endpoint(market: string, symbol: string): string {
  const normalizedMarket = normalizeQuoteMarket(market)
  const normalizedSymbol = symbol.trim().toUpperCase()
  const params = new URLSearchParams({
    mercado: normalizedMarket.toLowerCase(),
    simbolo: normalizedSymbol,
    'model.simbolo': normalizedSymbol,
    'model.mercado': normalizedMarket,
    'model.plazo': 't1',
  })

  return `/api/v2/${encodeURIComponent(normalizedMarket)}/Titulos/${encodeURIComponent(
    normalizedSymbol
  )}/Cotizacion?${params.toString()}`
}

export function getQuoteDetailEndpoint(
  market: string,
  symbol: string
): string {
  // Both quote paths use the canonical bCBA market from the shared contract.
  return `/api/v2/${encodeURIComponent(normalizeQuoteMarket(market))}/Titulos/${encodeURIComponent(
    symbol
  )}/CotizacionDetalle`
}
