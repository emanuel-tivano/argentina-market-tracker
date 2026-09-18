import 'server-only'

import {
  getCachedHistoryResponse,
  getStaleHistoryResponse,
  getHistoryCacheSizeForTests as getHistoryCacheSize,
  getOrCreateInFlightHistoryRequest,
  setCachedHistoryResponse,
} from '@/lib/server/history/historyCache'
import { getDemoHistoryData } from '@/lib/server/demo/demoMarketData'
import {
  iolFetch,
  isRecoverableIolUpstreamError,
} from '@/lib/server/upstream/iol'
import { createHistoryResponse } from '@/lib/server/history/historyResponse'
import {
  normalizeStockHistoryDataResult,
  StockHistoryNormalizationError,
  type StockHistoryMarket,
  type StockHistoryNormalizationCounts,
  type StockHistoryNormalizationResult,
  type StockHistoryRange,
  type StockHistoryResponseMeta,
  type StockHistorySuccessResponse,
  type StockHistoryVariant,
} from '@/lib/stockHistory'
import { ENV } from '@/lib/server/core/env'
import {
  getSafeErrorDetails,
  incrementMetricCounter,
  logServerInfo,
  logServerWarn,
} from '@/lib/server/core/observability'
import {
  getPerformanceTargetDate,
  selectPerformanceWindow,
  shiftCalendarDate,
  toMarketCalendarDate,
} from '@/lib/marketPerformance'

const HISTORY_REFERENCE_BUFFER_DAYS = 14
const HISTORY_DUPLICATE_ANOMALY_RATIO = 0.5

function getHistoryRequestDates(
  range: StockHistoryRange,
  now = new Date()
): { fechaDesde: string; fechaHasta: string } {
  const fechaHasta = toMarketCalendarDate(now)

  if (!fechaHasta) {
    throw new StockHistoryNormalizationError('Invalid history request date')
  }
  const targetDate = getPerformanceTargetDate(fechaHasta, range)
  const fechaDesde = targetDate
    ? shiftCalendarDate(targetDate, -HISTORY_REFERENCE_BUFFER_DAYS)
    : null

  if (!fechaDesde) {
    throw new StockHistoryNormalizationError('Invalid history request dates')
  }

  return { fechaDesde, fechaHasta }
}

function getHistoryEndpoint(
  market: string,
  symbol: string,
  range: StockHistoryRange,
  variant: StockHistoryVariant
): string {
  const { fechaDesde, fechaHasta } = getHistoryRequestDates(range)

  return `/api/v2/${encodeURIComponent(market)}/Titulos/${encodeURIComponent(
    symbol
  )}/Cotizacion/seriehistorica/${fechaDesde}/${fechaHasta}/${variant}`
}

function devLog(...args: unknown[]) {
  if (ENV.NODE_ENV !== 'production') {
    logServerInfo('stock-history', { args })
  }
}

async function fetchAndNormalizeHistoryVariant(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange,
  variant: StockHistoryVariant,
  requestId: string | undefined,
  requestCount: number
): Promise<StockHistoryNormalizationCounts & {
  diagnostics: StockHistoryNormalizationResult['diagnostics']
  endpoint: string
  normalizedData: StockHistorySuccessResponse['data']
  requestCount: number
  variant: StockHistoryVariant
}> {
  const endpoint = getHistoryEndpoint(market, symbol, range, variant)

  devLog('iol-request', { symbol, market, range, variant, endpoint })

  const data = await iolFetch(endpoint)
  const normalized = normalizeStockHistoryDataResult(data)
  const duplicateRatio = normalized.totalPoints > 0
    ? normalized.duplicatePoints / normalized.totalPoints
    : 0
  const hasDuplicateAnomaly =
    duplicateRatio >= HISTORY_DUPLICATE_ANOMALY_RATIO

  if (normalized.discardedPoints > 0) {
    const logNormalization =
      normalized.invalidPoints > 0 || hasDuplicateAnomaly
        ? logServerWarn
        : logServerInfo
    const event = normalized.invalidPoints > 0
      ? 'history.normalize.partial'
      : hasDuplicateAnomaly
        ? 'history.normalize.anomaly'
        : 'history.normalize.consolidated'

    logNormalization(event, {
      requestId,
      provider: 'iol',
      symbol,
      market,
      range,
      variant,
      endpoint,
      requestCount,
      recordsFetched: normalized.diagnostics.recordsFetched,
      validRecords: normalized.diagnostics.validRecords,
      uniqueTradingDays: normalized.totalPoints,
      duplicateTradingDays: normalized.diagnostics.duplicateTradingDays,
      conflictingDuplicates: normalized.diagnostics.conflictingDuplicatePoints,
      identicalDuplicates: normalized.diagnostics.identicalDuplicatePoints,
      ambiguousDuplicatePoints:
        normalized.diagnostics.ambiguousDuplicatePoints,
      omittedTradingDays: normalized.diagnostics.omittedTradingDays,
      maxMultiplicity: normalized.diagnostics.maxMultiplicity,
      duplicateRatio: Number(duplicateRatio.toFixed(6)),
      invalidPoints: normalized.invalidPoints,
      duplicatesRemoved: normalized.duplicatePoints,
      duplicatePoints: normalized.duplicatePoints,
      discardedPoints: normalized.discardedPoints,
      totalPoints: normalized.totalPoints,
    })
    // The legacy aggregate remains invalid + duplicate for existing dashboards.
    for (const [name, count] of [
      ['history.invalid_points.total', normalized.invalidPoints],
      ['history.duplicate_points.total', normalized.duplicatePoints],
      ['history.duplicate_trading_days.total', normalized.diagnostics.duplicateTradingDays],
      ['history.conflicting_duplicate_points.total', normalized.diagnostics.conflictingDuplicatePoints],
      ['history.ambiguous_duplicate_points.total', normalized.diagnostics.ambiguousDuplicatePoints],
      ['history.discarded_points.total', normalized.discardedPoints],
    ] as const) {
      if (count > 0) {
        incrementMetricCounter(name, count, {
          market,
          provider: 'iol',
          range,
          variant,
        })
      }
    }
    if (hasDuplicateAnomaly) {
      incrementMetricCounter('history.normalization_anomaly.total', 1, {
        market,
        provider: 'iol',
        range,
        variant,
      })
    }
  }

  devLog('normalized', {
    symbol,
    market,
    range,
    variant,
    endpoint,
    itemCount: normalized.data.length,
    recordsFetched: normalized.diagnostics.recordsFetched,
    duplicateTradingDays: normalized.diagnostics.duplicateTradingDays,
    conflictingDuplicates: normalized.diagnostics.conflictingDuplicatePoints,
    duplicatesRemoved: normalized.duplicatePoints,
    requestCount,
    invalidPoints: normalized.invalidPoints,
    duplicatePoints: normalized.duplicatePoints,
    discardedPoints: normalized.discardedPoints,
  })

  return {
    diagnostics: normalized.diagnostics,
    endpoint,
    normalizedData: normalized.data,
    invalidPoints: normalized.invalidPoints,
    duplicatePoints: normalized.duplicatePoints,
    discardedPoints: normalized.discardedPoints,
    totalPoints: normalized.totalPoints,
    requestCount,
    variant,
  }
}

type HistoryMetaOptions = StockHistoryNormalizationCounts & {
  stale: boolean
} & (
  | { source: 'demo'; resolvedVariant?: never }
  | { source: 'live'; resolvedVariant: StockHistoryVariant }
)

function buildHistoryMeta(options: HistoryMetaOptions): StockHistoryResponseMeta {
  if (options.source === 'live') {
    return {
      invalidPoints: options.invalidPoints,
      duplicatePoints: options.duplicatePoints,
      discardedPoints: options.discardedPoints,
      resolvedVariant: options.resolvedVariant,
      source: 'live',
      stale: options.stale,
      totalPoints: options.totalPoints,
    }
  }

  return {
    invalidPoints: options.invalidPoints,
    duplicatePoints: options.duplicatePoints,
    discardedPoints: options.discardedPoints,
    source: 'demo',
    stale: options.stale,
    totalPoints: options.totalPoints,
  }
}

async function fetchHistoryResponse(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange,
  requestId?: string
): Promise<StockHistorySuccessResponse> {
  if (ENV.MARKET_DATA_SOURCE === 'demo') {
    const fetchedAt = new Date().toISOString()
    const data = getDemoHistoryData(symbol, market, range)
    const response = createHistoryResponse(
      data,
      symbol,
      market,
      range,
      fetchedAt,
      'fresh',
      buildHistoryMeta({
        invalidPoints: 0,
        duplicatePoints: 0,
        discardedPoints: 0,
        source: 'demo',
        stale: false,
        totalPoints: data.length,
      })
    )

    setCachedHistoryResponse(symbol, market, range, response)
    incrementMetricCounter('history.response.total', 1, {
      cacheStatus: response.cacheStatus,
      source: 'demo',
      stale: false,
    })
    return response
  }

  try {
    const adjustedResult = await fetchAndNormalizeHistoryVariant(
      symbol,
      market,
      range,
      'ajustada',
      requestId,
      1
    )
    let result = adjustedResult

    // Variant fallback is intentionally conservative: only a successfully
    // received and normalized empty adjusted series can select sinAjustar.
    if (adjustedResult.normalizedData.length === 0) {
      result = await fetchAndNormalizeHistoryVariant(
        symbol,
        market,
        range,
        'sinAjustar',
        requestId,
        2
      )
    }
    const selectedWindow = selectPerformanceWindow(
      result.normalizedData,
      range
    )
    const normalizedData = selectedWindow.start
      ? selectedWindow.points
      : result.normalizedData
    const fetchedAt = new Date().toISOString()
    incrementMetricCounter('history.variant.selected.total', 1, {
      market,
      range,
      variant: result.variant,
    })

    devLog('selected-variant', {
      symbol,
      market,
      range,
      variant: result.variant,
      endpoint: result.endpoint,
      provider: 'iol',
      requestCount: result.requestCount,
      recordsFetched: result.diagnostics.recordsFetched,
      uniqueTradingDays: result.totalPoints,
      servedTradingDays: normalizedData.length,
      duplicateTradingDays: result.diagnostics.duplicateTradingDays,
      conflictingDuplicates: result.diagnostics.conflictingDuplicatePoints,
      duplicatesRemoved: result.duplicatePoints,
      itemCount: normalizedData.length,
      invalidPoints: result.invalidPoints,
      duplicatePoints: result.duplicatePoints,
      discardedPoints: result.discardedPoints,
    })

    const response = createHistoryResponse(
      normalizedData,
      symbol,
      market,
      range,
      fetchedAt,
      'fresh',
      buildHistoryMeta({
        invalidPoints: result.invalidPoints,
        duplicatePoints: result.duplicatePoints,
        discardedPoints: result.discardedPoints,
        resolvedVariant: result.variant,
        source: 'live',
        stale: false,
        totalPoints: normalizedData.length,
      })
    )

    setCachedHistoryResponse(symbol, market, range, response)
    incrementMetricCounter('history.response.total', 1, {
      cacheStatus: response.cacheStatus,
      source: 'live',
      stale: false,
    })
    return response
  } catch (error: unknown) {
    if (
      !(error instanceof StockHistoryNormalizationError) &&
      !isRecoverableIolUpstreamError(error)
    ) {
      throw error
    }

    const staleFallback = getStaleHistoryResponse(symbol, market, range)

    if (!staleFallback) {
      throw error
    }

    logServerWarn('history.stale-fallback', {
      requestId,
      symbol,
      market,
      range,
      reason: getSafeErrorDetails(error),
      cachedPoints: staleFallback.data.length,
    })
    incrementMetricCounter('history.stale_fallback.total', 1, {
      market,
      range,
      source: staleFallback.meta.source,
    })
    incrementMetricCounter('history.response.total', 1, {
      cacheStatus: staleFallback.cacheStatus,
      source: staleFallback.meta.source,
      stale: true,
    })

    return staleFallback
  }
}

export function getOrCreateHistoryResponse(
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange,
  options: {
    requestId?: string
  } = {}
): Promise<StockHistorySuccessResponse> {
  const cached = getCachedHistoryResponse(symbol, market, range)

  if (cached) {
    return Promise.resolve(cached)
  }

  return getOrCreateInFlightHistoryRequest(symbol, market, range, () =>
    fetchHistoryResponse(symbol, market, range, options.requestId)
  )
}

export function logHistoryRequestParams(context: {
  rawParams: unknown
  symbolParam: string
  normalizedSymbol: string | null
  rangeParam: string | null
  normalizedRange: string | null
  marketParam: string | null
  normalizedMarket: string | null
  url: string
}) {
  devLog('params', context)
}

export function getHistoryCacheSizeForTests() {
  return getHistoryCacheSize()
}
