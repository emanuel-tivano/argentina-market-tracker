import { toMarketDateString } from '@/features/dashboard/charts/advancedStockChart'
import { type StockHistoryPoint } from '@/lib/stockHistory'
import { parseStockHistoryCalendarDate } from '@/lib/stockHistoryDate'
import { type ResolvedCurrentQuote } from './currentQuoteTypes'
import { mergeLiveQuoteIntoHistoricalSeries } from './liveSessionCandle'

export type SyncedHistoryWithQuoteResult = {
  points: StockHistoryPoint[]
  syncedAt: string | null
  syncedQuote: boolean
}

type SyncHistoryWithQuoteOptions = {
  now?: Date
  quoteSource?: 'demo' | 'live' | null
}

const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'

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

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
    return null
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

function canAppendQuotePoint(currentQuote: ResolvedCurrentQuote): boolean {
  return (
    positivePrice(currentQuote.open) !== null &&
    positivePrice(currentQuote.high) !== null &&
    positivePrice(currentQuote.low) !== null
  )
}

function applyQuoteToHistoryPoint(
  existingPoint: StockHistoryPoint | undefined,
  quoteDate: string,
  currentQuote: ResolvedCurrentQuote
): StockHistoryPoint {
  const price = currentQuote.price as number
  const open =
    positivePrice(existingPoint?.open) ??
    positivePrice(currentQuote.open) ??
    price
  const highCandidates = [
    positivePrice(existingPoint?.high),
    positivePrice(currentQuote.high),
    price,
  ].filter((value): value is number => value !== null)
  const lowCandidates = [
    positivePrice(existingPoint?.low),
    positivePrice(currentQuote.low),
    price,
  ].filter((value): value is number => value !== null)

  return {
    ...existingPoint,
    date: quoteDate,
    ...(currentQuote.timestamp ? { timestamp: currentQuote.timestamp } : {}),
    open,
    high: Math.max(...highCandidates),
    low: Math.min(...lowCandidates),
    close: price,
    ...(currentQuote.volume !== null ? { volume: currentQuote.volume } : {}),
  }
}

export function syncHistoryWithCurrentQuote(
  historicalSeries: readonly StockHistoryPoint[],
  currentQuote: ResolvedCurrentQuote,
  options: SyncHistoryWithQuoteOptions = {}
): SyncedHistoryWithQuoteResult {
  if (options.quoteSource === 'live') {
    const merged = mergeLiveQuoteIntoHistoricalSeries(
      historicalSeries,
      currentQuote,
      {
        now: options.now ?? new Date(),
        quoteSource: 'live',
      }
    )

    return {
      points: merged.points,
      syncedAt: merged.liveSessionCandle?.timestamp ?? null,
      syncedQuote: merged.liveSessionCandle !== null,
    }
  }

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

  if (options.quoteSource === 'demo' && !existingPoint) {
    return {
      points: originalPoints,
      syncedAt: null,
      syncedQuote: false,
    }
  }

  if (!existingPoint && !canAppendQuotePoint(currentQuote)) {
    return {
      points: originalPoints,
      syncedAt: null,
      syncedQuote: false,
    }
  }

  pointsByDate.set(
    quoteDate,
    applyQuoteToHistoryPoint(existingPoint, quoteDate, {
      ...currentQuote,
      price: quotePrice,
    })
  )

  return {
    points: sortHistoryPoints(pointsByDate.values()),
    syncedAt: currentQuote.timestamp,
    syncedQuote: true,
  }
}
