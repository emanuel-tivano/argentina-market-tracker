export interface PanelTitulo {
  simbolo: string
  descripcion: string
  puntas?: {
    cantidadCompra?: number
    precioCompra?: number
    precioVenta?: number
    cantidadVenta?: number
  }
  ultimoPrecio?: number
  variacionPorcentual?: number
  apertura?: number
  maximo?: number
  minimo?: number
  ultimoCierre?: number
  volumen?: number
  fechaHora?: string
  montoOperado?: number
  cantidadOperaciones?: number
  moneda?: string
  plazo?: string
  laminaMinima?: number
  lote?: number
}

export interface PanelSuccessResponse {
  ok: true
  data: PanelTitulo[]
  fetchedAt: string
  servedAt: string
  staleUntil: string
  cacheStatus: 'fresh' | 'memory-cache' | 'stale'
  stale: boolean
  degradationReason?: 'upstream-unavailable'
}

export class PanelNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PanelNormalizationError'
  }
}

export const PANEL_ERROR_CODES = [
  'PANEL_ERROR',
  'RATE_LIMITED',
  'RATE_LIMIT_UNAVAILABLE',
  'REFRESH_COOLDOWN',
  'METHOD_NOT_ALLOWED',
  'INVALID_PANEL_TYPE',
] as const

export type PanelErrorCode = (typeof PANEL_ERROR_CODES)[number]

export interface PanelErrorResponse {
  ok: false
  error: PanelErrorCode
  requestId?: string
  details?: string
}

export type PanelResponse = PanelSuccessResponse | PanelErrorResponse

export interface PanelNormalizationIssue {
  reason: string
}

export interface PanelNormalizationResult {
  data: PanelTitulo[]
  droppedItemsCount: number
  droppedItemsSummary: PanelNormalizationIssue[]
}

export interface QuoteNormalizationOptions {
  symbol: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  let normalizedValue: string

  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmedValue)) {
    normalizedValue = trimmedValue.replace(/,/g, '')
  } else if (/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(trimmedValue)) {
    normalizedValue = trimmedValue.replace(/\./g, '').replace(',', '.')
  } else if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmedValue)) {
    normalizedValue = trimmedValue
  } else if (/^[+-]?\d+,\d+$/.test(trimmedValue)) {
    normalizedValue = trimmedValue.replace(',', '.')
  } else {
    return null
  }

  const parsedValue = Number(normalizedValue)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

export function isPanelErrorCode(value: unknown): value is PanelErrorCode {
  return (
    typeof value === 'string' &&
    PANEL_ERROR_CODES.includes(value as PanelErrorCode)
  )
}

export function isOptionalFiniteNumber(
  value: unknown
): value is number | undefined {
  return value === undefined || isFiniteNumber(value)
}

function isOptionalNumericInput(value: unknown): boolean {
  return value === undefined || value === null || toFiniteNumber(value) !== null
}

function isOptionalStringInput(value: unknown): boolean {
  return value === undefined || value === null || isNonEmptyString(value)
}

function hasPanelTituloIdentity(
  value: unknown
): value is Record<'simbolo' | 'descripcion', string> & Record<string, unknown> {
  return (
    isRecord(value) &&
    isNonEmptyString(value.simbolo) &&
    isNonEmptyString(value.descripcion)
  )
}

function extractArrayPayload(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data

  if (!isRecord(data)) return null

  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.titulos)) return data.titulos

  return null
}

type NumericPanelField = Exclude<
  keyof PanelTitulo,
  'simbolo' | 'descripcion' | 'puntas' | 'fechaHora' | 'moneda' | 'plazo'
>

type PuntaField = keyof NonNullable<PanelTitulo['puntas']>

export const NUMERIC_PANEL_FIELDS = [
  'ultimoPrecio',
  'variacionPorcentual',
  'apertura',
  'maximo',
  'minimo',
  'ultimoCierre',
  'volumen',
  'montoOperado',
  'cantidadOperaciones',
  'laminaMinima',
  'lote',
] as const satisfies readonly NumericPanelField[]

export const PUNTA_FIELDS = [
  'cantidadCompra',
  'precioCompra',
  'precioVenta',
  'cantidadVenta',
] as const satisfies readonly PuntaField[]

export function isPanelTitulo(value: unknown): value is PanelTitulo {
  if (!hasPanelTituloIdentity(value)) {
    return false
  }

  for (const field of NUMERIC_PANEL_FIELDS) {
    if (!isOptionalFiniteNumber(value[field])) {
      return false
    }
  }

  if (value.fechaHora !== undefined && !isNonEmptyString(value.fechaHora)) {
    return false
  }
  if (value.moneda !== undefined && !isNonEmptyString(value.moneda)) {
    return false
  }
  if (value.plazo !== undefined && !isNonEmptyString(value.plazo)) {
    return false
  }

  const puntas = value.puntas

  if (puntas === undefined) {
    return true
  }

  if (!isRecord(puntas)) {
    return false
  }

  return PUNTA_FIELDS.every((field) => isOptionalFiniteNumber(puntas[field]))
}

function setFiniteNumber(
  target: PanelTitulo,
  field: NumericPanelField,
  value: unknown
) {
  const numericValue = toFiniteNumber(value)

  if (numericValue !== null) {
    target[field] = numericValue
  }
}

function setFinitePuntaNumber(
  target: NonNullable<PanelTitulo['puntas']>,
  field: PuntaField,
  value: unknown
) {
  const numericValue = toFiniteNumber(value)

  if (numericValue !== null) {
    target[field] = numericValue
  }
}

function normalizePuntas(value: unknown): PanelTitulo['puntas'] {
  if (!isRecord(value)) {
    return undefined
  }

  const puntas: NonNullable<PanelTitulo['puntas']> = {}

  setFinitePuntaNumber(puntas, 'cantidadCompra', value.cantidadCompra)
  setFinitePuntaNumber(puntas, 'precioCompra', value.precioCompra)
  setFinitePuntaNumber(puntas, 'precioVenta', value.precioVenta)
  setFinitePuntaNumber(puntas, 'cantidadVenta', value.cantidadVenta)

  return Object.keys(puntas).length > 0 ? puntas : undefined
}

type NormalizePanelTituloResult =
  | { ok: true; data: PanelTitulo }
  | { ok: false; reason: string }

function parsePanelTitulo(value: unknown): NormalizePanelTituloResult {
  if (!isRecord(value)) {
    return { ok: false, reason: 'INVALID_ITEM_SHAPE' }
  }

  if (!isNonEmptyString(value.simbolo) || !isNonEmptyString(value.descripcion)) {
    return { ok: false, reason: 'INVALID_IDENTITY' }
  }

  for (const field of NUMERIC_PANEL_FIELDS) {
    if (!isOptionalNumericInput(value[field])) {
      return { ok: false, reason: `INVALID_NUMERIC_FIELD:${field}` }
    }
  }

  if (value.puntas !== undefined && value.puntas !== null) {
    if (!isRecord(value.puntas)) {
      return { ok: false, reason: 'INVALID_PUNTAS_SHAPE' }
    }

    for (const field of PUNTA_FIELDS) {
      if (!isOptionalNumericInput(value.puntas[field])) {
        return { ok: false, reason: `INVALID_PUNTA_FIELD:${field}` }
      }
    }
  }

  const item: PanelTitulo = {
    simbolo: value.simbolo,
    descripcion: value.descripcion,
  }

  const puntas = normalizePuntas(value.puntas)

  if (puntas) {
    item.puntas = puntas
  }

  setFiniteNumber(item, 'ultimoPrecio', value.ultimoPrecio)
  setFiniteNumber(item, 'variacionPorcentual', value.variacionPorcentual)
  setFiniteNumber(item, 'apertura', value.apertura)
  setFiniteNumber(item, 'maximo', value.maximo)
  setFiniteNumber(item, 'minimo', value.minimo)
  setFiniteNumber(item, 'ultimoCierre', value.ultimoCierre)
  setFiniteNumber(item, 'volumen', value.volumen)
  setFiniteNumber(item, 'montoOperado', value.montoOperado)
  setFiniteNumber(item, 'cantidadOperaciones', value.cantidadOperaciones)
  setFiniteNumber(item, 'laminaMinima', value.laminaMinima)
  setFiniteNumber(item, 'lote', value.lote)

  if (!isOptionalStringInput(value.fechaHora)) {
    return { ok: false, reason: 'INVALID_TIMESTAMP' }
  }

  if (!isOptionalStringInput(value.moneda)) {
    return { ok: false, reason: 'INVALID_CURRENCY' }
  }

  if (!isOptionalStringInput(value.plazo)) {
    return { ok: false, reason: 'INVALID_SETTLEMENT' }
  }

  if (isNonEmptyString(value.fechaHora)) {
    item.fechaHora = value.fechaHora
  }

  if (isNonEmptyString(value.moneda)) {
    item.moneda = value.moneda
  }
  if (isNonEmptyString(value.plazo)) {
    item.plazo = value.plazo
  }

  return {
    ok: true,
    data: item,
  }
}

function summarizeDroppedItems(reasons: string[]): PanelNormalizationIssue[] {
  const counts = new Map<string, number>()

  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({
      reason: `${reason}:${count}`,
    }))
}

export function normalizePanelDataResult(data: unknown): PanelNormalizationResult {
  const payload = extractArrayPayload(data)

  if (!payload) {
    throw new PanelNormalizationError('Invalid upstream payload structure')
  }

  const validItems: PanelTitulo[] = []
  const droppedReasons: string[] = []

  for (const item of payload) {
    const parsedItem = parsePanelTitulo(item)

    if (parsedItem.ok) {
      validItems.push(parsedItem.data)
    } else {
      droppedReasons.push(parsedItem.reason)
    }
  }

  if (payload.length > 0 && validItems.length === 0) {
    throw new PanelNormalizationError('Upstream payload contains no valid items')
  }

  return {
    data: validItems,
    droppedItemsCount: droppedReasons.length,
    droppedItemsSummary: summarizeDroppedItems(droppedReasons),
  }
}

export function normalizePanelData(data: unknown): PanelTitulo[] {
  return normalizePanelDataResult(data).data
}

function normalizeQuotePuntas(value: unknown): PanelTitulo['puntas'] {
  if (Array.isArray(value)) {
    return normalizePuntas(value[0])
  }

  return normalizePuntas(value)
}

export function normalizeQuoteData(
  data: unknown,
  options: QuoteNormalizationOptions
): PanelTitulo {
  const candidates = Array.isArray(data) ? data : [data]
  const quoteData = candidates.find(isRecord)

  if (!quoteData) {
    throw new PanelNormalizationError(
      'Invalid upstream quote payload structure'
    )
  }

  const descripcion =
    typeof quoteData.descripcion === 'string' &&
    quoteData.descripcion.trim().length > 0
      ? quoteData.descripcion
      : typeof quoteData.descripcionTitulo === 'string' &&
          quoteData.descripcionTitulo.trim().length > 0
        ? quoteData.descripcionTitulo
        : options.symbol

  const item: PanelTitulo = {
    simbolo: options.symbol,
    descripcion,
  }
  const puntas = normalizeQuotePuntas(quoteData.puntas)

  if (puntas) {
    item.puntas = puntas
  }

  setFiniteNumber(item, 'ultimoPrecio', quoteData.ultimoPrecio)
  setFiniteNumber(
    item,
    'variacionPorcentual',
    quoteData.variacionPorcentual ?? quoteData.variacion
  )
  setFiniteNumber(item, 'apertura', quoteData.apertura)
  setFiniteNumber(item, 'maximo', quoteData.maximo)
  setFiniteNumber(item, 'minimo', quoteData.minimo)
  setFiniteNumber(
    item,
    'ultimoCierre',
    quoteData.ultimoCierre ?? quoteData.cierreAnterior
  )
  setFiniteNumber(
    item,
    'volumen',
    quoteData.volumen ?? quoteData.volumenNominal
  )
  setFiniteNumber(item, 'montoOperado', quoteData.montoOperado)
  setFiniteNumber(item, 'cantidadOperaciones', quoteData.cantidadOperaciones)
  setFiniteNumber(item, 'laminaMinima', quoteData.laminaMinima)
  setFiniteNumber(item, 'lote', quoteData.lote)

  if (isNonEmptyString(quoteData.fechaHora)) {
    item.fechaHora = quoteData.fechaHora
  }
  if (isNonEmptyString(quoteData.moneda)) {
    item.moneda = quoteData.moneda
  }
  if (isNonEmptyString(quoteData.plazo)) {
    item.plazo = quoteData.plazo
  }

  return item
}
