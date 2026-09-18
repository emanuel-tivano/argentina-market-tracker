import { type StockData } from '@/features/dashboard/shared/stockData'
import {
  calculateDailyQuoteMetrics,
  getLatestHistoryQuotes,
} from '@/features/dashboard/charts/advancedStockChart'
import { type StockHistoryPoint } from '@/lib/stockHistory'
import { resolvePreviousClose } from '@/features/dashboard/shared/stockQuoteMetrics'
import { type StockQuoteDetail } from '@/lib/stockQuote'
import { calculateDailyVariationPercentage } from '@/lib/marketPerformance'
import { type ResolvedCurrentQuote } from './currentQuoteTypes'

export {
  getArgentinaMarketStatus,
  mergeLiveQuoteIntoHistoricalSeries,
  shouldUseLiveCandle,
} from './liveSessionCandle'
export type {
  ArgentinaMarketStatus,
  LiveSessionCandle,
} from './liveSessionCandle'
export { syncHistoryWithCurrentQuote } from './historyQuoteSync'
export type { SyncedHistoryWithQuoteResult } from './historyQuoteSync'
export type { ResolvedCurrentQuote } from './currentQuoteTypes'

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positivePrice(value: number | null | undefined): number | null {
  const numberValue = finiteNumber(value)

  return numberValue !== null && numberValue > 0 ? numberValue : null
}

function positiveVolume(value: number | null | undefined): number | null {
  const numberValue = finiteNumber(value)

  return numberValue !== null && numberValue > 0 ? numberValue : null
}

export function resolveCurrentStockQuote(
  stock: StockData,
  historicalSeries: readonly StockHistoryPoint[],
  quoteDetail: StockQuoteDetail | null = null
): ResolvedCurrentQuote {
  const { latestHistoricalPoint, previousHistoricalPoint } =
    getLatestHistoryQuotes(historicalSeries)
  const historicalDailyMetrics = calculateDailyQuoteMetrics(
    latestHistoricalPoint,
    previousHistoricalPoint
  )
  const snapshotPrice = positivePrice(stock.price)

  if (quoteDetail) {
    const previousClose = resolvePreviousClose({
      currentPrice: quoteDetail.price,
      variation: quoteDetail.variation,
      explicitPreviousClose: quoteDetail.previousClose,
      historicalPreviousClose: historicalDailyMetrics.previousClose,
    })

    return {
      price: quoteDetail.price,
      variation:
        (previousClose !== null
          ? calculateDailyVariationPercentage(previousClose, quoteDetail.price)
          : quoteDetail.variation),
      open: positivePrice(quoteDetail.open),
      previousClose,
      low: positivePrice(quoteDetail.low),
      high: positivePrice(quoteDetail.high),
      volume:
        positiveVolume(quoteDetail.volume) ??
        positiveVolume(stock.volume) ??
        positiveVolume(latestHistoricalPoint?.volume),
      amountTraded: finiteNumber(quoteDetail.amountTraded),
      operationCount: finiteNumber(quoteDetail.operationCount),
      buyQuantity: finiteNumber(quoteDetail.depth[0]?.buyQuantity),
      buyPrice: positivePrice(quoteDetail.depth[0]?.buyPrice),
      sellPrice: positivePrice(quoteDetail.depth[0]?.sellPrice),
      sellQuantity: finiteNumber(quoteDetail.depth[0]?.sellQuantity),
      description: quoteDetail.description || stock.description,
      timestamp: quoteDetail.timestamp,
      currency: quoteDetail.currency,
      settlement: quoteDetail.settlement,
      minimumSheet: finiteNumber(quoteDetail.minimumSheet),
      lot: finiteNumber(quoteDetail.lot),
      minimumQuantity: finiteNumber(quoteDetail.minimumQuantity),
      depth: quoteDetail.depth,
      source: 'detail',
    }
  }

  if (snapshotPrice === null) {
    if (!latestHistoricalPoint) {
      return {
        price: null,
        variation: null,
        open: null,
        previousClose: null,
        low: null,
        high: null,
        volume: null,
        amountTraded: null,
        operationCount: null,
        buyQuantity: null,
        buyPrice: null,
        sellPrice: null,
        sellQuantity: null,
        description: stock.description,
        timestamp: stock.quoteDate ?? null,
        currency: stock.currency ?? null,
        settlement: stock.settlement ?? null,
        minimumSheet: finiteNumber(stock.minimumSheet),
        lot: finiteNumber(stock.lot),
        minimumQuantity: null,
        depth: [],
        source: 'unavailable',
      }
    }

    return {
      price: latestHistoricalPoint.close,
      variation: historicalDailyMetrics.dailyVariation,
      open: positivePrice(latestHistoricalPoint.open),
      previousClose: historicalDailyMetrics.previousClose,
      low: positivePrice(latestHistoricalPoint.low),
      high: positivePrice(latestHistoricalPoint.high),
      volume: positiveVolume(latestHistoricalPoint.volume),
      amountTraded: finiteNumber(latestHistoricalPoint.amountTraded),
      operationCount: finiteNumber(latestHistoricalPoint.operationCount),
      buyQuantity: finiteNumber(latestHistoricalPoint.bid?.buyQuantity),
      buyPrice: positivePrice(latestHistoricalPoint.bid?.buyPrice),
      sellPrice: positivePrice(latestHistoricalPoint.bid?.sellPrice),
      sellQuantity: finiteNumber(latestHistoricalPoint.bid?.sellQuantity),
      description: latestHistoricalPoint.description ?? stock.description,
      timestamp: latestHistoricalPoint.timestamp ?? null,
      currency: latestHistoricalPoint.currency ?? null,
      settlement: latestHistoricalPoint.settlement ?? null,
      minimumSheet: finiteNumber(latestHistoricalPoint.minimumSheet),
      lot: finiteNumber(latestHistoricalPoint.lot),
      minimumQuantity: null,
      depth: latestHistoricalPoint.bid
        ? [
            {
              buyQuantity: finiteNumber(
                latestHistoricalPoint.bid.buyQuantity
              ),
              buyPrice: finiteNumber(latestHistoricalPoint.bid.buyPrice),
              sellPrice: finiteNumber(latestHistoricalPoint.bid.sellPrice),
              sellQuantity: finiteNumber(
                latestHistoricalPoint.bid.sellQuantity
              ),
            },
          ]
        : [],
      source: 'history',
    }
  }

  const snapshotPreviousClose = resolvePreviousClose({
    currentPrice: snapshotPrice,
    variation: stock.var,
    explicitPreviousClose: stock.close,
    historicalPreviousClose: historicalDailyMetrics.previousClose,
  })
  const snapshotVariation = finiteNumber(stock.var)

  return {
    price: snapshotPrice,
    variation:
      (snapshotPreviousClose !== null
        ? calculateDailyVariationPercentage(
            snapshotPreviousClose,
            snapshotPrice
          )
        : snapshotVariation),
    open: positivePrice(stock.open),
    previousClose: snapshotPreviousClose,
    low: positivePrice(stock.min),
    high: positivePrice(stock.max),
    volume:
      positiveVolume(stock.volume) ??
      positiveVolume(latestHistoricalPoint?.volume),
    amountTraded:
      finiteNumber(stock.amountTraded) ??
      finiteNumber(latestHistoricalPoint?.amountTraded),
    operationCount: finiteNumber(stock.operationCount),
    buyQuantity: finiteNumber(stock.buyQty),
    buyPrice: positivePrice(stock.buyPrice),
    sellPrice: positivePrice(stock.sellPrice),
    sellQuantity: finiteNumber(stock.sellQty),
    description: stock.description,
    timestamp: stock.quoteDate ?? null,
    currency: stock.currency ?? null,
    settlement: stock.settlement ?? null,
    minimumSheet: finiteNumber(stock.minimumSheet),
    lot: finiteNumber(stock.lot),
    minimumQuantity: null,
    depth:
      stock.buyQty !== null ||
      stock.buyPrice !== null ||
      stock.sellPrice !== null ||
      stock.sellQty !== null
        ? [
            {
              buyQuantity: finiteNumber(stock.buyQty),
              buyPrice: finiteNumber(stock.buyPrice),
              sellPrice: finiteNumber(stock.sellPrice),
              sellQuantity: finiteNumber(stock.sellQty),
            },
          ]
        : [],
    source: 'snapshot',
  }
}
