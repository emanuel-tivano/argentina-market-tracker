import {
  DEFAULT_STOCK_HISTORY_MARKET,
  isStockHistoryMarket,
  type StockHistoryMarket,
} from '@/lib/stockHistory'
import { isValidFreshnessContract } from '@/lib/freshness'
import { calculateDailyVariationPercentage } from '@/lib/marketPerformance'

export interface StockQuoteDepthLevel {
  buyQuantity: number | null
  buyPrice: number | null
  sellPrice: number | null
  sellQuantity: number | null
}

export class StockQuoteNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockQuoteNormalizationError'
  }
}

export interface StockQuoteDetail {
  symbol: string
  market: string
  description: string
  price: number
  variation: number | null
  open: number | null
  high: number | null
  low: number | null
  timestamp: string | null
  previousClose: number | null
  amountTraded: number | null
  volume: number | null
  averagePrice: number | null
  currency: string | null
  openInterest: number | null
  operationCount: number | null
  settlement: string | null
  minimumSheet: number | null
  lot: number | null
  minimumQuantity: number | null
  depth: StockQuoteDepthLevel[]
}

export interface StockQuoteSuccessResponse {
  ok: true
  data: StockQuoteDetail
  fetchedAt: string
  servedAt: string
  staleUntil: string
  cacheStatus: 'fresh' | 'memory-cache' | 'stale'
  stale: boolean
  degradationReason?: 'upstream-unavailable'
  source: 'demo' | 'live'
  market: StockHistoryMarket
  symbol: string
}

export const STOCK_QUOTE_ERROR_CODES = [
  'QUOTE_ERROR',
  'QUOTE_NOT_FOUND',
  'INVALID_SYMBOL',
  'INVALID_MARKET',
  'RATE_LIMITED',
  'RATE_LIMIT_UNAVAILABLE',
  'METHOD_NOT_ALLOWED',
] as const

export type StockQuoteErrorCode = (typeof STOCK_QUOTE_ERROR_CODES)[number]

export interface StockQuoteErrorResponse {
  ok: false
  error: StockQuoteErrorCode
  requestId?: string
  details?: string
}

export type StockQuoteResponse =
  | StockQuoteSuccessResponse
  | StockQuoteErrorResponse

export type StockQuoteInitialLoadState =
  | { status: 'available' }
  | { status: 'not-found' }
  | {
      status: 'rate-limited' | 'rate-limit-unavailable'
      retryAfterSec: number
    }
  | { status: 'upstream-unavailable' }
  | { status: 'no-initial-data' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function firstPositiveNumber(
  value: Record<string, unknown>,
  fields: readonly string[]
): number | null {
  for (const field of fields) {
    const numberValue = finiteNumber(value[field])

    if (numberValue !== null && numberValue > 0) {
      return numberValue
    }
  }

  return null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null
}

function normalizeDepthLevel(value: unknown): StockQuoteDepthLevel | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    buyQuantity: finiteNumber(value.cantidadCompra),
    buyPrice: finiteNumber(value.precioCompra),
    sellPrice: finiteNumber(value.precioVenta),
    sellQuantity: finiteNumber(value.cantidadVenta),
  }
}

export function normalizeStockQuoteDetail(
  value: unknown,
  fallbackSymbol = '',
  fallbackMarket = ''
): StockQuoteDetail {
  if (!isRecord(value)) {
    throw new StockQuoteNormalizationError(
      'Invalid upstream quote detail payload structure'
    )
  }

  const price = finiteNumber(value.ultimoPrecio)
  const symbol = optionalString(value.simbolo) ?? fallbackSymbol.trim().toUpperCase()
  const market = optionalString(value.mercado) ?? fallbackMarket.trim()

  if (price === null || price <= 0 || !symbol) {
    throw new StockQuoteNormalizationError(
      'Upstream quote detail payload contains no valid quote'
    )
  }

  const depth = Array.isArray(value.puntas)
    ? value.puntas
        .map(normalizeDepthLevel)
        .filter((level): level is StockQuoteDepthLevel => level !== null)
    : []
  const previousClose = firstPositiveNumber(value, ['cierreAnterior'])
  const calculatedVariation = calculateDailyVariationPercentage(
    previousClose,
    price
  )

  return {
    symbol,
    market,
    description: optionalString(value.descripcionTitulo) ?? symbol,
    price,
    variation: calculatedVariation ?? finiteNumber(value.variacion),
    open: finiteNumber(value.apertura),
    high: finiteNumber(value.maximo),
    low: finiteNumber(value.minimo),
    timestamp: optionalString(value.fechaHora),
    previousClose,
    amountTraded: finiteNumber(value.montoOperado),
    volume: firstPositiveNumber(value, [
      'volumenNominalOperado',
      'volumenNominal',
      'volumen',
      'volume',
    ]),
    averagePrice: finiteNumber(value.precioPromedio),
    currency: optionalString(value.moneda),
    openInterest: finiteNumber(value.interesesAbiertos),
    operationCount: finiteNumber(value.cantidadOperaciones),
    settlement: optionalString(value.plazo),
    minimumSheet: finiteNumber(value.laminaMinima),
    lot: finiteNumber(value.lote),
    minimumQuantity: finiteNumber(value.cantidadMinima),
    depth,
  }
}

function normalizeQuoteIdentityPart(value: string): string {
  return value.trim().toLowerCase()
}

export function hasMatchingStockQuoteIdentity(
  detail: Pick<StockQuoteDetail, 'market' | 'symbol'>,
  expectedSymbol: string,
  expectedMarket?: string
): boolean {
  if (
    normalizeQuoteIdentityPart(detail.symbol) !==
    normalizeQuoteIdentityPart(expectedSymbol)
  ) {
    return false
  }

  return (
    !expectedMarket ||
    !detail.market ||
    normalizeQuoteIdentityPart(detail.market) ===
      normalizeQuoteIdentityPart(expectedMarket)
  )
}

export function buildStockQuoteApiPath(
  symbol: string,
  market: StockHistoryMarket = DEFAULT_STOCK_HISTORY_MARKET
): string {
  const params = new URLSearchParams({ market })

  return `/api/stocks/${encodeURIComponent(symbol)}/quote?${params.toString()}`
}

export function isStockQuoteDepthLevel(
  value: unknown
): value is StockQuoteDepthLevel {
  if (!isRecord(value)) {
    return false
  }

  return ['buyQuantity', 'buyPrice', 'sellPrice', 'sellQuantity'].every(
    (field) => value[field] === null || finiteNumber(value[field]) !== null
  )
}

export function isStockQuoteDetail(value: unknown): value is StockQuoteDetail {
  const price = isRecord(value) ? finiteNumber(value.price) : null

  return (
    isRecord(value) &&
    typeof value.symbol === 'string' &&
    typeof value.market === 'string' &&
    typeof value.description === 'string' &&
    price !== null &&
    price > 0 &&
    [
      'variation',
      'open',
      'high',
      'low',
      'previousClose',
      'amountTraded',
      'volume',
      'averagePrice',
      'openInterest',
      'operationCount',
      'minimumSheet',
      'lot',
      'minimumQuantity',
    ].every((field) => value[field] === null || finiteNumber(value[field]) !== null) &&
    (value.timestamp === null || typeof value.timestamp === 'string') &&
    (value.currency === null || typeof value.currency === 'string') &&
    (value.settlement === null || typeof value.settlement === 'string') &&
    Array.isArray(value.depth) &&
    value.depth.every(isStockQuoteDepthLevel)
  )
}

export function isStockQuoteSuccessResponse(
  value: unknown
): value is StockQuoteSuccessResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    isStockQuoteDetail(value.data) &&
    isValidFreshnessContract(value) &&
    (value.source === 'demo' || value.source === 'live') &&
    typeof value.market === 'string' &&
    isStockHistoryMarket(value.market) &&
    typeof value.symbol === 'string' &&
    hasMatchingStockQuoteIdentity(value.data, value.symbol, value.market)
  )
}

export function isStockQuoteErrorCode(
  value: unknown
): value is StockQuoteErrorCode {
  return (
    typeof value === 'string' &&
    STOCK_QUOTE_ERROR_CODES.includes(value as StockQuoteErrorCode)
  )
}
