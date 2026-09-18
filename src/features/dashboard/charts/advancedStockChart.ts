import { type StockHistoryPoint } from '@/lib/stockHistory'
import { parseStockHistoryCalendarDate } from '@/lib/stockHistoryDate'
import {
  calculateDailyVariationPercentage,
  calculateReturnPercentage,
  isSuspiciousPriceTransition,
} from '@/lib/marketPerformance'

export type CurrentStockQuote = {
  close: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  date: string | null
  previousClose: number | null
  dailyVariation: number | null
}

export type MergeTodayQuoteOptions = {
  timeZone?: string
}

export type NormalizedHistoryPoint = {
  date: string
  time: number
  close: number
  open?: number
  high?: number
  low?: number
  volume?: number
}

export type ChartHistoryPointInput = {
  date: string
  close: number | string | null | undefined
  open?: number | string | null
  high?: number | string | null
  low?: number | string | null
  volume?: number | string | null
}

export type NormalizedCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type StockPeriodMetrics = {
  currentPrice: number
  periodVariation: number | null
  periodHigh: number
  periodLow: number
  averageVolume: number | null
  highLowRange: number
  pointCount: number
}

export type LatestHistoryQuotes = {
  latestHistoricalPoint: StockHistoryPoint | null
  previousHistoricalPoint: StockHistoryPoint | null
}

export type DailyQuoteMetrics = {
  previousClose: number | null
  dailyVariation: number | null
}

export function getLatestHistoryQuotes(
  points: readonly StockHistoryPoint[]
): LatestHistoryQuotes {
  const validHistory = [...points]
    .filter(
      (point) =>
        Number.isFinite(point.close) &&
        point.close > 0 &&
        parseStockHistoryCalendarDate(point.date.trim().slice(0, 10)) !== null
    )
    .sort((first, second) => first.date.localeCompare(second.date))

  return {
    latestHistoricalPoint: validHistory.at(-1) ?? null,
    previousHistoricalPoint: validHistory.at(-2) ?? null,
  }
}

export function calculateDailyQuoteMetrics(
  latestHistoricalPoint: StockHistoryPoint | null,
  previousHistoricalPoint: StockHistoryPoint | null
): DailyQuoteMetrics {
  if (!latestHistoricalPoint) {
    return {
      previousClose: null,
      dailyVariation: null,
    }
  }

  const previousClose =
    typeof latestHistoricalPoint.previousClose === 'number' &&
    Number.isFinite(latestHistoricalPoint.previousClose) &&
    latestHistoricalPoint.previousClose > 0
      ? latestHistoricalPoint.previousClose
      : previousHistoricalPoint?.close && previousHistoricalPoint.close > 0
        ? previousHistoricalPoint.close
        : null
  const explicitVariation =
    typeof latestHistoricalPoint.dailyVariation === 'number' &&
    Number.isFinite(latestHistoricalPoint.dailyVariation) &&
    latestHistoricalPoint.dailyVariation !== 0
      ? latestHistoricalPoint.dailyVariation
      : null
  const calculatedVariation =
    previousClose !== null &&
    !(
      previousHistoricalPoint &&
      isSuspiciousPriceTransition(
        previousHistoricalPoint,
        latestHistoricalPoint
      )
    )
      ? calculateDailyVariationPercentage(
          previousClose,
          latestHistoricalPoint.close
        )
      : null

  return {
    previousClose,
    dailyVariation: calculatedVariation ?? explicitVariation,
  }
}

export const calculatePeriodStats = calculatePeriodMetrics

const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MIN_CANDLE_COVERAGE = 0.5

export function toMarketDateString(
  date: Date,
  timeZone: string = ARGENTINA_TIME_ZONE
): string | null {
  if (!Number.isFinite(date.getTime())) {
    return null
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return year && month && day ? `${year}-${month}-${day}` : null
}

function normalizeMarketDate(value: string): string | null {
  const trimmedValue = value.trim()
  const dateOnlyValue = trimmedValue.slice(0, 10)

  return parseStockHistoryCalendarDate(dateOnlyValue)?.date ?? null
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  const normalizedValue =
    trimmedValue.includes(',') && !trimmedValue.includes('.')
      ? trimmedValue.replace(',', '.')
      : trimmedValue.replace(/,/g, '')
  const parsedValue = Number(normalizedValue)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toPositivePrice(value: unknown): number | null {
  const numericValue = toFiniteNumber(
    value as number | string | null | undefined
  )

  return numericValue !== null && numericValue > 0 ? numericValue : null
}

function toNonNegativeNumber(value: unknown): number | null {
  const numericValue = toFiniteNumber(
    value as number | string | null | undefined
  )

  return numericValue !== null && numericValue >= 0 ? numericValue : null
}

function normalizeQuoteRecord(
  value: Record<string, unknown>,
  timeZone: string
): CurrentStockQuote | null {
  const close = toPositivePrice(value.price ?? value.ultimoPrecio ?? value.close)

  if (close === null) {
    return null
  }

  const timestamp = value.quoteDate ?? value.fechaHora ?? value.date
  const trimmedTimestamp =
    typeof timestamp === 'string' ? timestamp.trim() : ''
  const calendarDate = parseStockHistoryCalendarDate(trimmedTimestamp)
  const datePrefix = trimmedTimestamp.slice(0, 10)
  const hasInvalidCalendarPrefix =
    DATE_ONLY_PATTERN.test(datePrefix) &&
    parseStockHistoryCalendarDate(datePrefix) === null
  const parsedDate =
    trimmedTimestamp &&
    !calendarDate &&
    !hasInvalidCalendarPrefix &&
    !DATE_ONLY_PATTERN.test(trimmedTimestamp)
      ? new Date(trimmedTimestamp)
      : null
  const date = calendarDate
    ? calendarDate.date
    : parsedDate
      ? toMarketDateString(parsedDate, timeZone)
      : null

  return {
    close,
    open: toPositivePrice(value.open ?? value.apertura),
    high: toPositivePrice(value.max ?? value.high ?? value.maximo),
    low: toPositivePrice(value.min ?? value.low ?? value.minimo),
    volume: toNonNegativeNumber(
      value.volume ?? value.volumen ?? value.volumenNominal
    ),
    date,
    previousClose: toPositivePrice(
      value.previousClose ?? value.cierreAnterior
    ),
    dailyVariation: toFiniteNumber(
      (value.var ?? value.variacionPorcentual ?? value.variacion) as
        | number
        | string
        | null
        | undefined
    ),
  }
}

export function normalizeCurrentStockQuote(
  payload: unknown,
  timeZone: string = ARGENTINA_TIME_ZONE
): CurrentStockQuote | null {
  const candidates = Array.isArray(payload) ? payload : [payload]

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue
    }

    const normalized = normalizeQuoteRecord(candidate, timeZone)

    if (normalized) {
      return normalized
    }
  }

  return null
}

export function mergeTodayQuoteIntoHistory(
  history: StockHistoryPoint[],
  quotePayload: unknown,
  options: MergeTodayQuoteOptions = {}
): StockHistoryPoint[] {
  const timeZone = options.timeZone ?? ARGENTINA_TIME_ZONE
  const pointsByDate = new Map<string, StockHistoryPoint>()

  history.forEach((point) => {
    const date = normalizeMarketDate(point.date)

    if (date && Number.isFinite(point.close)) {
      pointsByDate.set(date, { ...point, date })
    }
  })

  const quote = normalizeCurrentStockQuote(quotePayload, timeZone)

  if (!quote) {
    return Array.from(pointsByDate.values()).sort((first, second) =>
      first.date.localeCompare(second.date)
    )
  }

  // A refresh timestamp is not evidence of a market operation.
  const quoteDate = quote.date

  if (!quoteDate) {
    return Array.from(pointsByDate.values()).sort((first, second) =>
      first.date.localeCompare(second.date)
    )
  }

  const existingQuoteDate = pointsByDate.get(quoteDate)
  const latestDate = Array.from(pointsByDate.keys()).sort().at(-1)

  if (!existingQuoteDate && latestDate && quoteDate < latestDate) {
    return Array.from(pointsByDate.values()).sort((first, second) =>
      first.date.localeCompare(second.date)
    )
  }

  const previousPoint = Array.from(pointsByDate.values())
    .filter((point) => point.date < quoteDate)
    .sort((first, second) => first.date.localeCompare(second.date))
    .at(-1)
  const open =
    quote.open ??
    quote.previousClose ??
    existingQuoteDate?.open ??
    previousPoint?.close ??
    quote.close
  const high = Math.max(
    quote.high ?? existingQuoteDate?.high ?? open,
    open,
    quote.close
  )
  const low = Math.min(
    quote.low ?? existingQuoteDate?.low ?? open,
    open,
    quote.close
  )

  pointsByDate.set(quoteDate, {
    ...existingQuoteDate,
    date: quoteDate,
    close: quote.close,
    open,
    high,
    low,
    ...(quote.volume !== null
      ? { volume: quote.volume }
      : existingQuoteDate?.volume !== undefined
        ? { volume: existingQuoteDate.volume }
        : {}),
  })

  return Array.from(pointsByDate.values()).sort((first, second) =>
    first.date.localeCompare(second.date)
  )
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function normalizeHistoryPoints(
  points: readonly ChartHistoryPointInput[]
): NormalizedHistoryPoint[] {
  const pointsByDate = new Map<string, NormalizedHistoryPoint>()

  points.forEach((point) => {
    const date = point.date.trim().slice(0, 10)
    const parsedDate = parseStockHistoryCalendarDate(date)
    const time = parsedDate
      ? Math.floor(parsedDate.timestampMs / 1000)
      : null
    const close = toFiniteNumber(point.close)

    if (time === null || close === null) {
      return
    }

    const open = toFiniteNumber(point.open)
    const high = toFiniteNumber(point.high)
    const low = toFiniteNumber(point.low)
    const volume = toFiniteNumber(point.volume)

    pointsByDate.set(date, {
      date,
      time,
      close,
      ...(open !== null ? { open } : {}),
      ...(high !== null ? { high } : {}),
      ...(low !== null ? { low } : {}),
      ...(volume !== null ? { volume } : {}),
    })
  })

  return Array.from(pointsByDate.values()).sort(
    (first, second) => first.time - second.time
  )
}

export function normalizeCandles(
  points: NormalizedHistoryPoint[]
): NormalizedCandle[] {
  return points.flatMap((point) => {
    if (
      !isFiniteNumber(point.open) ||
      !isFiniteNumber(point.high) ||
      !isFiniteNumber(point.low)
    ) {
      return []
    }

    return [
      {
        time: point.time,
        open: point.open,
        high: Math.max(point.open, point.close, point.high),
        low: Math.min(point.open, point.close, point.low),
        close: point.close,
      },
    ]
  })
}

export function hasSufficientCandles(
  points: NormalizedHistoryPoint[],
  candles: NormalizedCandle[]
): boolean {
  if (points.length === 0 || candles.length === 0) {
    return false
  }

  const minimumCount = points.length === 1 ? 1 : 2

  return (
    candles.length >= minimumCount &&
    candles.length / points.length >= MIN_CANDLE_COVERAGE
  )
}

export function calculatePeriodMetrics(
  points: NormalizedHistoryPoint[]
): StockPeriodMetrics | null {
  const first = points[0]
  const last = points.at(-1)

  if (!first || !last) {
    return null
  }

  const highs = points.map((point) => point.high ?? point.close)
  const lows = points.map((point) => point.low ?? point.close)
  const volumes = points
    .map((point) => point.volume)
    .filter(isFiniteNumber)
  const periodHigh = Math.max(...highs)
  const periodLow = Math.min(...lows)

  return {
    currentPrice: last.close,
    periodVariation: calculateReturnPercentage(first.close, last.close),
    periodHigh,
    periodLow,
    averageVolume:
      volumes.length > 0
        ? volumes.reduce((total, volume) => total + volume, 0) / volumes.length
        : null,
    highLowRange: periodHigh - periodLow,
    pointCount: points.length,
  }
}
