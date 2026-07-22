import 'server-only'

import {
  isValidStockHistoryCacheState,
  type StockHistoryErrorCode,
  type StockHistoryErrorResponse,
  type StockHistoryMarket,
  type StockHistoryResponseMeta,
  type StockHistoryRange,
  type StockHistorySuccessResponse,
} from '@/lib/stockHistory'
import { jsonNoStoreResponse } from '@/lib/server/core/httpResponse'

export function createHistoryResponse(
  data: StockHistorySuccessResponse['data'],
  symbol: string,
  market: StockHistoryMarket,
  range: StockHistoryRange,
  fetchedAt: string,
  cacheStatus: StockHistorySuccessResponse['cacheStatus'],
  meta: StockHistoryResponseMeta
): StockHistorySuccessResponse {
  if (!isValidStockHistoryCacheState(cacheStatus, meta.stale)) {
    throw new Error('Invalid stock history cache state')
  }

  return {
    ok: true,
    data,
    fetchedAt,
    servedAt: new Date().toISOString(),
    cacheStatus,
    range,
    market,
    symbol,
    meta,
  }
}

export function jsonHistoryResponse(
  body: unknown,
  init: ResponseInit = {},
  requestId?: string
) {
  return jsonNoStoreResponse(body, init, requestId)
}

export function historyErrorResponse(
  error: StockHistoryErrorCode,
  init: ResponseInit,
  details?: string,
  requestId?: string
) {
  const body: StockHistoryErrorResponse = {
    ok: false,
    error,
    ...(requestId ? { requestId } : {}),
    ...(details ? { details } : {}),
  }

  return jsonHistoryResponse(body, init, requestId)
}
