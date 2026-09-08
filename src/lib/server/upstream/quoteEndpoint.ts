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
  return `/api/v2/${encodeURIComponent(market)}/Titulos/${encodeURIComponent(
    symbol
  )}/CotizacionDetalle`
}
