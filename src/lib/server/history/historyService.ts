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

const RANGE_DAYS: Record<StockHistoryRange, number> = {
  '1W': 7,
  '1M': 31,
  '3M': 93,
  '6M': 186,
  '1Y': 365,
}

function getHistoryEndpoint(
  market: string,
  symbol: string,
  range: StockHistoryRange,
  variant: StockHistoryVariant
): string {
  const now = new Date()
  const fechaHasta = now.toISOString().slice(0, 10)
  const fechaDesde = new Date(now)

  fechaDesde.setUTCDate(fechaDesde.getUTCDate() - RANGE_DAYS[range])

  return `/api/v2/${encodeURIComponent(market)}/Titulos/${encodeURIComponent(
    symbol
  )}/Cotizacion/seriehistorica/${fechaDesde.toISOString().slice(0, 10)}/${fechaHasta}/${variant}`
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
  requestId?: string
): Promise<{
  discardedPoints: number
  endpoint: string
  normalizedData: StockHistorySuccessResponse['data']
  totalPoints: number
  variant: StockHistoryVariant
}> {
  const endpoint = getHistoryEndpoint(market, symbol, range, variant)

  devLog('iol-request', { symbol, market, range, variant, endpoint })

  const data = await iolFetch(endpoint)
  const normalized = normalizeStockHistoryDataResult(data)

  if (normalized.discardedPoints > 0) {
    logServerWarn('history.normalize.partial', {
      requestId,
      symbol,
      market,
      range,
      variant,
      endpoint,
      discardedPoints: normalized.discardedPoints,
      totalPoints: normalized.totalPoints,
    })
    incrementMetricCounter('history.discarded_points.total', normalized.discardedPoints, {
      market,
      range,
      variant,
    })
  }

  devLog('normalized', {
    symbol,
    market,
    range,
    variant,
    endpoint,
    itemCount: normalized.data.length,
    discardedPoints: normalized.discardedPoints,
  })

  return {
    endpoint,
    normalizedData: normalized.data,
    discardedPoints: normalized.discardedPoints,
    totalPoints: normalized.totalPoints,
    variant,
  }
}

type HistoryMetaOptions = {
  discardedPoints: number
  stale: boolean
  totalPoints: number
} & (
  | { source: 'demo'; resolvedVariant?: never }
  | { source: 'live'; resolvedVariant: StockHistoryVariant }
)

function buildHistoryMeta(options: HistoryMetaOptions): StockHistoryResponseMeta {
  if (options.source === 'live') {
    return {
      discardedPoints: options.discardedPoints,
      resolvedVariant: options.resolvedVariant,
      source: 'live',
      stale: options.stale,
      totalPoints: options.totalPoints,
    }
  }

  return {
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
      requestId
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
        requestId
      )
    }
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
      itemCount: result.normalizedData.length,
      discardedPoints: result.discardedPoints,
    })

    const response = createHistoryResponse(
      result.normalizedData,
      symbol,
      market,
      range,
      fetchedAt,
      'fresh',
      buildHistoryMeta({
        discardedPoints: result.discardedPoints,
        resolvedVariant: result.variant,
        source: 'live',
        stale: false,
        totalPoints: result.totalPoints,
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
