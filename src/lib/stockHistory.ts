import { parseFinancialNumber as toFiniteNumber } from '@/lib/financialNumber'
import { parseStockHistoryCalendarDate } from '@/lib/stockHistoryDate'

export class StockHistoryNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockHistoryNormalizationError'
  }
}

export const STOCK_HISTORY_RANGES = ['1W', '1M', '3M', '6M', '1Y'] as const

export type StockHistoryRange = (typeof STOCK_HISTORY_RANGES)[number]
export const DEFAULT_STOCK_HISTORY_RANGE: StockHistoryRange = '1M'
export const STOCK_HISTORY_MARKETS = ['bCBA'] as const
export type StockHistoryMarket = (typeof STOCK_HISTORY_MARKETS)[number]
export const STOCK_HISTORY_VARIANTS = ['ajustada', 'sinAjustar'] as const
export type StockHistoryVariant = (typeof STOCK_HISTORY_VARIANTS)[number]
export const DEFAULT_STOCK_HISTORY_MARKET: StockHistoryMarket = 'bCBA'
export type StockHistoryCacheStatus = 'fresh' | 'memory-cache' | 'stale'

export function isValidStockHistoryCacheState(
  cacheStatus: unknown,
  stale: unknown
): cacheStatus is StockHistoryCacheStatus {
  return (
    (cacheStatus === 'stale' && stale === true) ||
    ((cacheStatus === 'fresh' || cacheStatus === 'memory-cache') &&
      stale === false)
  )
}

export interface StockHistoryPoint {
  date: string
  timestamp?: string
  close: number
  open?: number
  high?: number
  low?: number
  volume?: number
  dailyVariation?: number
  previousClose?: number
  amountTraded?: number
  averagePrice?: number
  currency?: string
  openInterest?: number
  operationCount?: number
  description?: string
  settlement?: string
  minimumSheet?: number
  lot?: number
  bid?: {
    buyQuantity?: number
    buyPrice?: number
    sellPrice?: number
    sellQuantity?: number
  }
}

export interface StockHistorySuccessResponse {
  ok: true
  data: StockHistoryPoint[]
  fetchedAt: string
  servedAt: string
  cacheStatus: StockHistoryCacheStatus
  range: StockHistoryRange
  market: StockHistoryMarket
  symbol: string
  meta: StockHistoryResponseMeta
}

type StockHistoryResponseMetaBase = {
  discardedPoints: number
  requestId?: string
  stale: boolean
  totalPoints: number
}

export type StockHistoryResponseMeta = StockHistoryResponseMetaBase &
  (
    | {
        source: 'live'
        resolvedVariant: StockHistoryVariant
      }
    | {
        source: 'demo'
        resolvedVariant?: never
      }
  )

export const STOCK_HISTORY_ERROR_CODES = [
  'HISTORY_ERROR',
  'INVALID_SYMBOL',
  'INVALID_MARKET',
  'INVALID_RANGE',
  'RATE_LIMITED',
  'RATE_LIMIT_UNAVAILABLE',
  'METHOD_NOT_ALLOWED',
] as const

export type StockHistoryErrorCode = (typeof STOCK_HISTORY_ERROR_CODES)[number]

export interface StockHistoryErrorResponse {
  ok: false
  error: StockHistoryErrorCode
  requestId?: string
  details?: string
}

export type StockHistoryResponse =
  | StockHistorySuccessResponse
  | StockHistoryErrorResponse

export function isStockHistoryMarket(
  value: string | null
): value is StockHistoryMarket {
  return (
    typeof value === 'string' &&
    STOCK_HISTORY_MARKETS.includes(value as StockHistoryMarket)
  )
}

export function buildStockHistoryApiPath(
  symbol: string,
  range: StockHistoryRange,
  market: StockHistoryMarket
): string {
  const params = new URLSearchParams({
    range,
    market,
  })

  return `/api/stocks/${encodeURIComponent(symbol)}/history?${params.toString()}`
}

const FIELD_ALIASES = {
  date: ['fecha', 'date', 'fechaHora', 'fechaCotizacion'],
  timestamp: ['fechaHora', 'quoteDate', 'timestamp'],
  close: [
    'ultimoPrecio',
    'cierre',
    'close',
    'precio',
    'precioCierre',
    'precioAjustado',
    'cierreAjustado',
  ],
  open: ['apertura', 'open', 'precioApertura'],
  high: ['maximo', 'high', 'precioMaximo'],
  low: ['minimo', 'low', 'precioMinimo'],
  volume: [
    'volumenNominalOperado',
    'volumenNominal',
    'volumen',
    'volume',
  ],
  dailyVariation: ['variacion', 'variacionPorcentual', 'dailyVariation'],
  previousClose: ['cierreAnterior', 'ultimoCierre', 'previousClose'],
  amountTraded: ['montoOperado', 'amountTraded'],
  averagePrice: ['precioPromedio', 'averagePrice'],
  currency: ['moneda', 'currency'],
  openInterest: ['interesesAbiertos', 'openInterest'],
  operationCount: ['cantidadOperaciones', 'operationCount'],
  description: ['descripcionTitulo', 'descripcion', 'description'],
  settlement: ['plazo', 'settlement'],
  minimumSheet: ['laminaMinima', 'minimumSheet'],
  lot: ['lote', 'lot'],
  bid: ['puntas', 'bid'],
} as const

const ARRAY_PAYLOAD_FIELDS = ['data', 'cotizaciones', 'serie'] as const

function isNotNull<T>(value: T | null): value is T {
  return value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeFieldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

function getFirstField(
  value: Record<string, unknown>,
  fields: readonly string[]
): unknown {
  const directMatch = fields.find((field) => field in value)

  if (directMatch) {
    return value[directMatch]
  }

  const normalizedFields = new Set(fields.map(normalizeFieldName))
  const matchingKey = Object.keys(value).find((key) =>
    normalizedFields.has(normalizeFieldName(key))
  )

  if (matchingKey) {
    return value[matchingKey]
  }

  return undefined
}

function formatDateParts(year: string, month: string, day: string): string | null {
  const normalizedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`

  return parseStockHistoryCalendarDate(normalizedDate)?.date ?? null
}

function normalizeObjectKeys(value: Record<string, unknown>): Record<string, string[]> {
  return Object.keys(value).reduce<Record<string, string[]>>((keys, key) => {
    const normalizedKey = normalizeFieldName(key)

    keys[normalizedKey] = [...(keys[normalizedKey] ?? []), key]
    return keys
  }, {})
}

function extractArrayPayload(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data

  if (!isRecord(data)) return null

  for (const field of ARRAY_PAYLOAD_FIELDS) {
    if (Array.isArray(data[field])) return data[field]
  }

  const normalizedKeys = normalizeObjectKeys(data)

  for (const field of ARRAY_PAYLOAD_FIELDS) {
    const matchingKeys = normalizedKeys[normalizeFieldName(field)] ?? []
    const matchingArray = matchingKeys
      .map((key) => data[key])
      .find((value) => Array.isArray(value))

    if (Array.isArray(matchingArray)) return matchingArray
  }

  return null
}

function normalizeDate(value: unknown): string | null {
  if (!isNonEmptyString(value)) {
    return null
  }

  const trimmedValue = value.trim()
  const isoDate = trimmedValue.slice(0, 10)

  const parsedIsoDate = parseStockHistoryCalendarDate(isoDate)

  if (parsedIsoDate) {
    return parsedIsoDate.date
  }

  const localDateMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)

  if (localDateMatch) {
    const [, day, month, year] = localDateMatch

    return formatDateParts(year, month, day)
  }

  return null
}

function setOptionalNumber(
  point: StockHistoryPoint,
  field:
    | 'open'
    | 'high'
    | 'low'
    | 'volume'
    | 'dailyVariation'
    | 'previousClose'
    | 'amountTraded'
    | 'averagePrice'
    | 'openInterest'
    | 'operationCount'
    | 'minimumSheet'
    | 'lot',
  value: unknown
) {
  const numberValue = toFiniteNumber(
    value,
    ['volume', 'openInterest', 'operationCount', 'minimumSheet', 'lot'].includes(field)
      ? 'grouped'
      : 'decimal'
  )

  if (numberValue !== null) {
    point[field] = numberValue
  }
}

export function isStockHistoryVariant(
  value: unknown
): value is StockHistoryVariant {
  return (
    typeof value === 'string' &&
    STOCK_HISTORY_VARIANTS.includes(value as StockHistoryVariant)
  )
}

function setOptionalString(
  point: StockHistoryPoint,
  field: 'currency' | 'description' | 'settlement',
  value: unknown
) {
  if (isNonEmptyString(value)) {
    point[field] = value.trim()
  }
}

function normalizeBid(value: unknown): StockHistoryPoint['bid'] {
  const candidate = Array.isArray(value) ? value[0] : value

  if (!isRecord(candidate)) {
    return undefined
  }

  const bid: NonNullable<StockHistoryPoint['bid']> = {}
  const fields = {
    buyQuantity: ['cantidadCompra', 'buyQuantity'],
    buyPrice: ['precioCompra', 'buyPrice'],
    sellPrice: ['precioVenta', 'sellPrice'],
    sellQuantity: ['cantidadVenta', 'sellQuantity'],
  } as const

  for (const [field, aliases] of Object.entries(fields) as Array<
    [keyof typeof fields, (typeof fields)[keyof typeof fields]]
  >) {
    const numericValue = toFiniteNumber(
      getFirstField(candidate, aliases),
      field === 'buyQuantity' || field === 'sellQuantity' ? 'grouped' : 'decimal'
    )

    if (numericValue !== null) {
      bid[field] = numericValue
    }
  }

  return Object.keys(bid).length > 0 ? bid : undefined
}

function normalizeHistoryPoint(value: unknown): StockHistoryPoint | null {
  if (!isRecord(value)) {
    return null
  }

  const date = normalizeDate(getFirstField(value, FIELD_ALIASES.date))
  const close = toFiniteNumber(getFirstField(value, FIELD_ALIASES.close))

  if (!date || close === null) {
    return null
  }

  const point: StockHistoryPoint = {
    date,
    close,
  }
  const timestamp = getFirstField(value, FIELD_ALIASES.timestamp)

  if (isNonEmptyString(timestamp)) {
    point.timestamp = timestamp.trim()
  }

  setOptionalNumber(point, 'open', getFirstField(value, FIELD_ALIASES.open))
  setOptionalNumber(point, 'high', getFirstField(value, FIELD_ALIASES.high))
  setOptionalNumber(point, 'low', getFirstField(value, FIELD_ALIASES.low))
  setOptionalNumber(point, 'volume', getFirstField(value, FIELD_ALIASES.volume))
  setOptionalNumber(
    point,
    'dailyVariation',
    getFirstField(value, FIELD_ALIASES.dailyVariation)
  )
  setOptionalNumber(
    point,
    'previousClose',
    getFirstField(value, FIELD_ALIASES.previousClose)
  )
  setOptionalNumber(
    point,
    'amountTraded',
    getFirstField(value, FIELD_ALIASES.amountTraded)
  )
  setOptionalNumber(
    point,
    'averagePrice',
    getFirstField(value, FIELD_ALIASES.averagePrice)
  )
  setOptionalNumber(
    point,
    'openInterest',
    getFirstField(value, FIELD_ALIASES.openInterest)
  )
  setOptionalNumber(
    point,
    'operationCount',
    getFirstField(value, FIELD_ALIASES.operationCount)
  )
  setOptionalNumber(
    point,
    'minimumSheet',
    getFirstField(value, FIELD_ALIASES.minimumSheet)
  )
  setOptionalNumber(point, 'lot', getFirstField(value, FIELD_ALIASES.lot))
  setOptionalString(point, 'currency', getFirstField(value, FIELD_ALIASES.currency))
  setOptionalString(
    point,
    'description',
    getFirstField(value, FIELD_ALIASES.description)
  )
  setOptionalString(
    point,
    'settlement',
    getFirstField(value, FIELD_ALIASES.settlement)
  )

  const bid = normalizeBid(getFirstField(value, FIELD_ALIASES.bid))

  if (bid) {
    point.bid = bid
  }

  return point
}

export interface StockHistoryNormalizationResult {
  data: StockHistoryPoint[]
  discardedPoints: number
  totalPoints: number
}

export function normalizeStockHistoryDataResult(
  data: unknown
): StockHistoryNormalizationResult {
  const payload = extractArrayPayload(data)

  if (!payload) {
    throw new StockHistoryNormalizationError(
      'Invalid upstream history payload structure'
    )
  }

  const normalizedItems = payload.map((item) => normalizeHistoryPoint(item))
  const validItems = normalizedItems.filter(isNotNull)
  const invalidItemsCount = payload.length - validItems.length

  if (payload.length > 0 && invalidItemsCount === payload.length) {
    throw new StockHistoryNormalizationError(
      'Upstream history payload contains no valid items'
    )
  }

  const pointsByDate = new Map<string, StockHistoryPoint>()

  for (const point of validItems) {
    // The provider can repeat a calendar date. Preserve the existing chart
    // policy explicitly: the last valid row in payload order wins.
    pointsByDate.set(point.date, point)
  }

  const uniqueItems = [...pointsByDate.values()].sort((first, second) =>
    first.date.localeCompare(second.date)
  )
  const duplicateItemsCount = validItems.length - uniqueItems.length

  return {
    data: uniqueItems,
    discardedPoints: invalidItemsCount + duplicateItemsCount,
    totalPoints: uniqueItems.length,
  }
}

export function normalizeStockHistoryData(data: unknown): StockHistoryPoint[] {
  return normalizeStockHistoryDataResult(data).data
}

export function isStockHistoryRange(
  value: string | null
): value is StockHistoryRange {
  return (
    typeof value === 'string' &&
    STOCK_HISTORY_RANGES.includes(value as StockHistoryRange)
  )
}

export function isStockHistoryErrorCode(
  value: unknown
): value is StockHistoryErrorCode {
  return (
    typeof value === 'string' &&
    STOCK_HISTORY_ERROR_CODES.includes(value as StockHistoryErrorCode)
  )
}

export function isStockHistoryPoint(value: unknown): value is StockHistoryPoint {
  const optionalNumbers = [
    'open',
    'high',
    'low',
    'volume',
    'dailyVariation',
    'previousClose',
    'amountTraded',
    'averagePrice',
    'openInterest',
    'operationCount',
    'minimumSheet',
    'lot',
  ] as const
  const optionalStrings = [
    'timestamp',
    'currency',
    'description',
    'settlement',
  ] as const

  if (!isRecord(value)) {
    return false
  }

  const bid = value.bid

  return (
    parseStockHistoryCalendarDate(value.date) !== null &&
    isFiniteNumber(value.close) &&
    optionalNumbers.every(
      (field) => value[field] === undefined || isFiniteNumber(value[field])
    ) &&
    optionalStrings.every(
      (field) => value[field] === undefined || isNonEmptyString(value[field])
    ) &&
    (bid === undefined ||
      (isRecord(bid) &&
        ['buyQuantity', 'buyPrice', 'sellPrice', 'sellQuantity'].every(
          (field) =>
            bid[field] === undefined ||
            isFiniteNumber(bid[field])
        )))
  )
}
