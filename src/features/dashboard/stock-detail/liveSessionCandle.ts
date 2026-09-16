import { toMarketDateString } from '@/features/dashboard/charts/advancedStockChart'
import { type StockHistoryPoint } from '@/lib/stockHistory'
import { type ResolvedCurrentQuote } from './currentQuoteTypes'

export type ArgentinaMarketStatus = {
  isOpen: boolean
  sessionDate: string | null
}

export type LiveSessionCandle = StockHistoryPoint & {
  timestamp: string
}

type MergeLiveQuoteOptions = {
  now: Date
  quoteSource: 'demo' | 'live' | null
  previousLiveCandle?: LiveSessionCandle | null
}

type MergeLiveQuoteResult = {
  points: StockHistoryPoint[]
  liveSessionCandle: LiveSessionCandle | null
}

const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'
const MARKET_OPEN_MINUTE = 11 * 60
const MARKET_CLOSE_MINUTE = 17 * 60

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positivePrice(value: number | null | undefined): number | null {
  const numberValue = finiteNumber(value)

  return numberValue !== null && numberValue > 0 ? numberValue : null
}

function getArgentinaDateTimeParts(date: Date) {
  if (!Number.isFinite(date.getTime())) {
    return null
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARGENTINA_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const weekday = parts.find((part) => part.type === 'weekday')?.value
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)

  return weekday && Number.isFinite(hour) && Number.isFinite(minute)
    ? { weekday, minuteOfDay: hour * 60 + minute }
    : null
}

export function getArgentinaMarketStatus(
  now: Date
): ArgentinaMarketStatus {
  const sessionDate = toMarketDateString(now, ARGENTINA_TIME_ZONE)
  const parts = getArgentinaDateTimeParts(now)
  const isWeekday =
    parts !== null && !['Sat', 'Sun'].includes(parts.weekday)
  const isWithinRegularSession =
    parts !== null &&
    parts.minuteOfDay >= MARKET_OPEN_MINUTE &&
    parts.minuteOfDay < MARKET_CLOSE_MINUTE

  return {
    isOpen: Boolean(sessionDate && isWeekday && isWithinRegularSession),
    sessionDate,
  }
}

export function shouldUseLiveCandle(
  quote: ResolvedCurrentQuote,
  marketStatus: ArgentinaMarketStatus,
  quoteSource: 'demo' | 'live' | null
): boolean {
  if (
    quoteSource !== 'live' ||
    quote.source !== 'detail' ||
    !marketStatus.sessionDate ||
    quote.price === null ||
    quote.price <= 0 ||
    !quote.timestamp
  ) {
    return false
  }

  const operationTime = new Date(quote.timestamp)
  const operationDate = toMarketDateString(
    operationTime,
    ARGENTINA_TIME_ZONE
  )
  const operationParts = getArgentinaDateTimeParts(operationTime)

  return (
    operationDate === marketStatus.sessionDate &&
    operationParts !== null &&
    !['Sat', 'Sun'].includes(operationParts.weekday) &&
    operationParts.minuteOfDay >= MARKET_OPEN_MINUTE &&
    operationParts.minuteOfDay < MARKET_CLOSE_MINUTE
  )
}

export function mergeLiveQuoteIntoHistoricalSeries(
  historicalSeries: readonly StockHistoryPoint[],
  currentQuote: ResolvedCurrentQuote,
  options: MergeLiveQuoteOptions
): MergeLiveQuoteResult {
  const historicalPoints = historicalSeries.map((point) => ({ ...point }))
  const marketStatus = getArgentinaMarketStatus(options.now)

  if (
    !shouldUseLiveCandle(
      currentQuote,
      marketStatus,
      options.quoteSource
    ) ||
    !marketStatus.sessionDate ||
    !currentQuote.timestamp ||
    currentQuote.price === null
  ) {
    return {
      points: historicalPoints,
      liveSessionCandle: null,
    }
  }

  const sessionDate = marketStatus.sessionDate
  const existingIndex = historicalPoints.findIndex(
    (point) => point.date === sessionDate
  )
  const existingPoint =
    existingIndex >= 0 ? historicalPoints[existingIndex] : undefined
  const previousLiveCandle =
    options.previousLiveCandle?.date === sessionDate
      ? options.previousLiveCandle
      : null
  const open =
    positivePrice(existingPoint?.open) ??
    positivePrice(currentQuote.open) ??
    positivePrice(previousLiveCandle?.open) ??
    currentQuote.price
  const existingHigh =
    positivePrice(existingPoint?.high) ??
    positivePrice(previousLiveCandle?.high) ??
    positivePrice(currentQuote.high) ??
    open
  const existingLow =
    positivePrice(existingPoint?.low) ??
    positivePrice(previousLiveCandle?.low) ??
    positivePrice(currentQuote.low) ??
    open
  const liveSessionCandle: LiveSessionCandle = {
    ...existingPoint,
    date: sessionDate,
    timestamp: currentQuote.timestamp,
    open,
    high: Math.max(existingHigh, currentQuote.price),
    low: Math.min(existingLow, currentQuote.price),
    close: currentQuote.price,
    ...(currentQuote.volume !== null
      ? { volume: currentQuote.volume }
      : {}),
  }

  if (existingIndex >= 0) {
    historicalPoints[existingIndex] = liveSessionCandle
  } else {
    historicalPoints.push(liveSessionCandle)
  }

  return {
    points: historicalPoints.sort((first, second) =>
      first.date.localeCompare(second.date)
    ),
    liveSessionCandle,
  }
}