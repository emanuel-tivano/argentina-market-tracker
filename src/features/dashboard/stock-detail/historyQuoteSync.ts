import { toMarketDateString } from '@/features/dashboard/charts/advancedStockChart'
import { type StockHistoryPoint } from '@/lib/stockHistory'
import { parseStockHistoryCalendarDate } from '@/lib/stockHistoryDate'
import { type ResolvedCurrentQuote } from './currentQuoteTypes'

export type SyncedHistoryWithQuoteResult = {
  points: StockHistoryPoint[]
  syncedAt: string | null
  syncedQuote: boolean
}

type SyncHistoryWithQuoteOptions = {
  quoteSource?: 'demo' | 'live' | null
}

const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'
const EXPLICIT_TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i
const MARKET_LOCAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positivePrice(value: number | null | undefined): number | null {
  const numberValue = finiteNumber(value)

  return numberValue !== null && numberValue > 0 ? numberValue : null
}

function marketDateFromTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const trimmedValue = value.trim()
  const calendarDate = parseStockHistoryCalendarDate(trimmedValue)

  if (calendarDate) {
    return calendarDate.date
  }

  const datePrefix = trimmedValue.slice(0, 10)
  const prefixedCalendarDate = parseStockHistoryCalendarDate(datePrefix)

  if (!prefixedCalendarDate) {
    return null
  }

  // A timestamp without an offset has no absolute instant to convert. Treat it
  // as a market-local wall clock so the browser timezone cannot move its date.
  if (!EXPLICIT_TIME_ZONE_PATTERN.test(trimmedValue)) {
    const localTimestamp = MARKET_LOCAL_TIMESTAMP_PATTERN.exec(trimmedValue)
    const hour = Number(localTimestamp?.[1])
    const minute = Number(localTimestamp?.[2])
    const second = Number(localTimestamp?.[3] ?? 0)

    return localTimestamp &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 59
      ? prefixedCalendarDate.date
      : null
  }

  const parsedDate = new Date(trimmedValue)

  return Number.isFinite(parsedDate.getTime())
    ? toMarketDateString(parsedDate, ARGENTINA_TIME_ZONE)
    : null
}

function normalizeHistoryDate(value: string): string | null {
  const date = value.trim().slice(0, 10)

  return parseStockHistoryCalendarDate(date)?.date ?? null
}

function sortHistoryPoints(
  points: Iterable<StockHistoryPoint>
): StockHistoryPoint[] {
  return [...points].sort((first, second) => {
    const firstDate = normalizeHistoryDate(first.date) ?? first.date
    const secondDate = normalizeHistoryDate(second.date) ?? second.date

    return firstDate.localeCompare(secondDate)
  })
}

function cloneDedupedHistoryByDate(
  historicalSeries: readonly StockHistoryPoint[]
): Map<string, StockHistoryPoint> {
  const pointsByDate = new Map<string, StockHistoryPoint>()

  for (const point of historicalSeries) {
    const date = normalizeHistoryDate(point.date)

    if (date && Number.isFinite(point.close)) {
      pointsByDate.set(date, { ...point, date })
    }
  }

  return pointsByDate
}

function getLatestHistoryDate(pointsByDate: Map<string, StockHistoryPoint>) {
  return [...pointsByDate.keys()].sort().at(-1) ?? null
}

type CompleteQuoteOhlc = {
  open: number
  high: number
  low: number
}

function getCompleteQuoteOhlc(
  currentQuote: ResolvedCurrentQuote
): CompleteQuoteOhlc | null {
  const open = positivePrice(currentQuote.open)
  const high = positivePrice(currentQuote.high)
  const low = positivePrice(currentQuote.low)

  return open !== null && high !== null && low !== null
    ? { open, high, low }
    : null
}

function applyQuoteToHistoryPoint(
  existingPoint: StockHistoryPoint | undefined,
  quoteDate: string,
  currentQuote: ResolvedCurrentQuote,
  quoteOhlc: CompleteQuoteOhlc
): StockHistoryPoint {
  const price = currentQuote.price as number

  return {
    ...existingPoint,
    date: quoteDate,
    ...(currentQuote.timestamp ? { timestamp: currentQuote.timestamp } : {}),
    ...quoteOhlc,
    close: price,
    ...(currentQuote.volume !== null ? { volume: currentQuote.volume } : {}),
  }
}

export function syncHistoryWithCurrentQuote(
  historicalSeries: readonly StockHistoryPoint[],
  currentQuote: ResolvedCurrentQuote,
  options: SyncHistoryWithQuoteOptions = {}
): SyncedHistoryWithQuoteResult {
  const pointsByDate = cloneDedupedHistoryByDate(historicalSeries)
  const originalPoints = sortHistoryPoints(pointsByDate.values())
  const quotePrice = positivePrice(currentQuote.price)
  const quoteDate = marketDateFromTimestamp(currentQuote.timestamp)

  if (
    quotePrice === null ||
    !quoteDate ||
    currentQuote.source === 'history' ||
    currentQuote.source === 'unavailable'
  ) {
    return {
      points: originalPoints,
      syncedAt: null,
      syncedQuote: false,
    }
  }

  const latestHistoryDate = getLatestHistoryDate(pointsByDate)

  if (latestHistoryDate && quoteDate < latestHistoryDate) {
    return {
      points: originalPoints,
      syncedAt: null,
      syncedQuote: false,
    }
  }

  const existingPoint = pointsByDate.get(quoteDate)
  const quoteOhlc = getCompleteQuoteOhlc(currentQuote)

  if (options.quoteSource === 'demo' && !existingPoint) {
    return {
      points: originalPoints,
      syncedAt: null,
      syncedQuote: false,
    }
  }

  if (!quoteOhlc) {
    return {
      points: originalPoints,
      syncedAt: null,
      syncedQuote: false,
    }
  }

  pointsByDate.set(
    quoteDate,
    applyQuoteToHistoryPoint(
      existingPoint,
      quoteDate,
      {
        ...currentQuote,
        price: quotePrice,
      },
      quoteOhlc
    )
  )

  return {
    points: sortHistoryPoints(pointsByDate.values()),
    syncedAt: currentQuote.timestamp,
    syncedQuote: true,
  }
}
