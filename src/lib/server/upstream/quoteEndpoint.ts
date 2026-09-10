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

export function getQuoteDetailEndpoint(
  market: string,
  symbol: string
): string {
  // Both quote paths use the canonical bCBA market from the shared contract.
  return `/api/v2/${encodeURIComponent(normalizeQuoteMarket(market))}/Titulos/${encodeURIComponent(
    symbol
  )}/CotizacionDetalle`
}
