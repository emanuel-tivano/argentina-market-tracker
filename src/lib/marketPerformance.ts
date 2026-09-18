import { parseStockHistoryCalendarDate } from '@/lib/stockHistoryDate'

export const PERFORMANCE_PERIODS = [
  '1W',
  '1M',
  '3M',
  '6M',
  'YTD',
  '1Y',
  '3Y',
  '5Y',
] as const

export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number]

export type DatedClose = {
  date: string
  close: number
}

export type SplitCorporateAction = {
  /** First trading date on the post-split share basis. */
  effectiveDate: string
  /** New shares divided by old shares (2 for 2:1, 0.1 for 1:10). */
  ratio: number
}

export type PriceBasis = 'provider-adjusted' | 'raw'

export type PerformanceWindow<T extends DatedClose> = {
  points: T[]
  start: T | null
  end: T | null
  targetDate: string | null
  returnPercentage: number | null
  status: 'ok' | 'empty' | 'insufficient' | 'missing-reference'
}

export type SuspiciousPriceDiscontinuity = {
  previousDate: string
  currentDate: string
  previousClose: number
  currentClose: number
  changePercentage: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'

function isPositiveFinitePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function toCalendarDate(value: string): string | null {
  return parseStockHistoryCalendarDate(value.trim().slice(0, 10))?.date ?? null
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function toMarketCalendarDate(
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

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function subtractCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() - months
  const targetYear = year + Math.floor(month / 12)
  const targetMonth = ((month % 12) + 12) % 12
  const targetDay = Math.min(
    date.getUTCDate(),
    daysInUtcMonth(targetYear, targetMonth)
  )

  return new Date(Date.UTC(targetYear, targetMonth, targetDay))
}

function subtractCalendarYears(date: Date, years: number): Date {
  const targetYear = date.getUTCFullYear() - years
  const targetMonth = date.getUTCMonth()
  const targetDay = Math.min(
    date.getUTCDate(),
    daysInUtcMonth(targetYear, targetMonth)
  )

  return new Date(Date.UTC(targetYear, targetMonth, targetDay))
}

export function shiftCalendarDate(value: string, days: number): string | null {
  const parsed = parseStockHistoryCalendarDate(value)

  if (!parsed || !Number.isInteger(days)) {
    return null
  }

  return formatUtcDate(new Date(parsed.timestampMs + days * DAY_MS))
}

export function getPerformanceTargetDate(
  endDate: string,
  period: PerformancePeriod
): string | null {
  const parsed = parseStockHistoryCalendarDate(endDate)

  if (!parsed) {
    return null
  }

  const end = new Date(parsed.timestampMs)

  switch (period) {
    case '1W':
      return shiftCalendarDate(endDate, -7)
    case '1M':
      return formatUtcDate(subtractCalendarMonths(end, 1))
    case '3M':
      return formatUtcDate(subtractCalendarMonths(end, 3))
    case '6M':
      return formatUtcDate(subtractCalendarMonths(end, 6))
    case 'YTD':
      return `${end.getUTCFullYear()}-01-01`
    case '1Y':
      return formatUtcDate(subtractCalendarYears(end, 1))
    case '3Y':
      return formatUtcDate(subtractCalendarYears(end, 3))
    case '5Y':
      return formatUtcDate(subtractCalendarYears(end, 5))
  }
}

export function calculateReturnPercentage(
  startPrice: number | null | undefined,
  endPrice: number | null | undefined
): number | null {
  if (
    !isPositiveFinitePrice(startPrice) ||
    !isPositiveFinitePrice(endPrice)
  ) {
    return null
  }

  const result = (endPrice / startPrice - 1) * 100

  return Number.isFinite(result) ? result : null
}

export const calculateDailyVariationPercentage = calculateReturnPercentage

export function isSuspiciousPriceTransition(
  previous: DatedClose,
  current: DatedClose
): boolean {
  const previousDate = parseStockHistoryCalendarDate(
    previous.date.trim().slice(0, 10)
  )
  const currentDate = parseStockHistoryCalendarDate(
    current.date.trim().slice(0, 10)
  )
  const changePercentage = calculateReturnPercentage(
    previous.close,
    current.close
  )

  return Boolean(
    previousDate &&
      currentDate &&
      currentDate.timestampMs - previousDate.timestampMs <= 7 * DAY_MS &&
      changePercentage !== null &&
      Math.abs(changePercentage) >= 35
  )
}

/**
 * Fails closed on an extreme adjacent-session jump. It does not infer or apply
 * a split factor: only an authoritative corporate-action source may do that.
 */
export function findSuspiciousPriceDiscontinuity<T extends DatedClose>(
  input: readonly T[]
): SuspiciousPriceDiscontinuity | null {
  const points = normalizeDatedClosePoints(input)

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const changePercentage = calculateReturnPercentage(
      previous.close,
      current.close
    )

    if (changePercentage !== null && isSuspiciousPriceTransition(previous, current)) {
      return {
        previousDate: previous.date,
        currentDate: current.date,
        previousClose: previous.close,
        currentClose: current.close,
        changePercentage,
      }
    }
  }

  return null
}

export function deriveStartPriceFromReturnPercentage(
  endPrice: number | null | undefined,
  returnPercentage: number | null | undefined
): number | null {
  if (
    !isPositiveFinitePrice(endPrice) ||
    typeof returnPercentage !== 'number' ||
    !Number.isFinite(returnPercentage)
  ) {
    return null
  }

  const factor = 1 + returnPercentage / 100

  if (!Number.isFinite(factor) || factor <= 0) {
    return null
  }

  const startPrice = endPrice / factor

  return isPositiveFinitePrice(startPrice) ? startPrice : null
}

export function normalizeDatedClosePoints<T extends DatedClose>(
  points: readonly T[]
): T[] {
  const pointsByDate = new Map<string, T>()

  for (const point of points) {
    const date = toCalendarDate(point.date)

    if (!date || !isPositiveFinitePrice(point.close)) {
      continue
    }

    pointsByDate.set(date, { ...point, date })
  }

  return [...pointsByDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date)
  )
}

export function selectPerformanceWindow<T extends DatedClose>(
  input: readonly T[],
  period: PerformancePeriod
): PerformanceWindow<T> {
  const points = normalizeDatedClosePoints(input)
  const end = points.at(-1) ?? null

  if (!end) {
    return {
      points: [],
      start: null,
      end: null,
      targetDate: null,
      returnPercentage: null,
      status: 'empty',
    }
  }

  const targetDate = getPerformanceTargetDate(end.date, period)

  if (!targetDate) {
    return {
      points: [],
      start: null,
      end,
      targetDate: null,
      returnPercentage: null,
      status: 'insufficient',
    }
  }

  const start = points.findLast((point) => point.date <= targetDate) ?? null

  if (!start) {
    return {
      points,
      start: null,
      end,
      targetDate,
      returnPercentage: null,
      status: points.length === 1 ? 'insufficient' : 'missing-reference',
    }
  }

  const selectedPoints = points.filter((point) => point.date >= start.date)
  const returnPercentage = calculateReturnPercentage(start.close, end.close)

  return {
    points: selectedPoints,
    start,
    end,
    targetDate,
    returnPercentage,
    status:
      selectedPoints.length >= 2 && returnPercentage !== null
        ? 'ok'
        : 'insufficient',
  }
}

/**
 * Converts raw closes to the latest share basis using explicit split actions.
 * Provider-adjusted data is returned unchanged so a split cannot be applied twice.
 */
export function applySplitCorporateActions<T extends DatedClose>(
  input: readonly T[],
  actions: readonly SplitCorporateAction[],
  basis: PriceBasis
): T[] {
  const points = normalizeDatedClosePoints(input)

  if (basis === 'provider-adjusted') {
    return points
  }

  const validActions = actions
    .flatMap((action) => {
      const effectiveDate = toCalendarDate(action.effectiveDate)

      return effectiveDate && isPositiveFinitePrice(action.ratio)
        ? [{ effectiveDate, ratio: action.ratio }]
        : []
    })
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))

  return points.map((point) => {
    const cumulativeRatio = validActions.reduce(
      (ratio, action) =>
        point.date < action.effectiveDate ? ratio * action.ratio : ratio,
      1
    )
    const close = point.close / cumulativeRatio

    return {
      ...point,
      close: Number.isFinite(close) && close > 0 ? close : point.close,
    }
  })
}
