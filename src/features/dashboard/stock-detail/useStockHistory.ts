import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  buildStockHistoryApiPath,
  DEFAULT_STOCK_HISTORY_MARKET,
  isStockHistoryMarket,
  type StockHistoryMarket,
  type StockHistoryPoint,
  type StockHistoryRange,
  type StockHistorySuccessResponse,
} from '@/lib/stockHistory'
import { fetchStockHistory } from './stockHistoryClient'

export const STOCK_HISTORY_REFRESH_INTERVAL_MS = 5 * 60_000

export function normalizeStockHistoryRefreshIntervalMs(value: number): number {
  return Number.isFinite(value) && value > 0
    ? value
    : STOCK_HISTORY_REFRESH_INTERVAL_MS
}

type UseStockHistoryOptions = {
  enabled?: boolean
  initialData?: StockHistorySuccessResponse
  refreshIntervalMs?: number
}

export type HistoryRequestIdentity = {
  symbol: string
  market: StockHistoryMarket
  range: StockHistoryRange
}

export function matchesHistoryRequestIdentity(
  response: StockHistorySuccessResponse,
  identity: HistoryRequestIdentity
): boolean {
  return (
    response.symbol === identity.symbol &&
    response.market === identity.market &&
    response.range === identity.range
  )
}

function normalizeResponseForIdentity(
  response: StockHistorySuccessResponse,
  identity: HistoryRequestIdentity
): StockHistorySuccessResponse {
  if (!matchesHistoryRequestIdentity(response, identity)) {
    throw new Error('La respuesta histórica no coincide con la solicitud activa.')
  }

  return normalizeHistoryResponse(response)
}

function getPointSortValue(point: StockHistoryPoint): string {
  return point.timestamp ?? point.date
}

export function normalizeLiveHistoryPoints(
  points: StockHistoryPoint[]
): StockHistoryPoint[] {
  const pointsByTime = new Map<string, StockHistoryPoint>()

  for (const point of points) {
    pointsByTime.set(point.timestamp ?? point.date, point)
  }

  return [...pointsByTime.values()].sort((first, second) =>
    getPointSortValue(first).localeCompare(getPointSortValue(second))
  )
}

function normalizeHistoryResponse(
  response: StockHistorySuccessResponse
): StockHistorySuccessResponse {
  return {
    ...response,
    data: normalizeLiveHistoryPoints(response.data),
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useStockHistory(
  symbol: string,
  range: StockHistoryRange,
  market: string = DEFAULT_STOCK_HISTORY_MARKET,
  options: UseStockHistoryOptions = {}
) {
  const {
    enabled = true,
    initialData,
    refreshIntervalMs = STOCK_HISTORY_REFRESH_INTERVAL_MS,
  } = options
  const normalizedSymbol = symbol.trim().toUpperCase()
  const normalizedMarket = market.trim()
  const normalizedRefreshIntervalMs =
    normalizeStockHistoryRefreshIntervalMs(refreshIntervalMs)
  const historyMarket = isStockHistoryMarket(normalizedMarket)
    ? normalizedMarket
    : null
  const requestIdentity = useMemo<HistoryRequestIdentity | null>(
    () =>
      normalizedSymbol && historyMarket
        ? { symbol: normalizedSymbol, market: historyMarket, range }
        : null,
    [historyMarket, normalizedSymbol, range]
  )
  const fetchUrl =
    enabled && normalizedSymbol && historyMarket
      ? buildStockHistoryApiPath(normalizedSymbol, range, historyMarket)
      : null
  const inFlightRefreshRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(false)
  const [refreshError, setRefreshError] = useState<{
    error: Error
    key: string
  } | null>(null)
  const [isSilentRefreshing, setIsSilentRefreshing] = useState(false)

  const { data, error, isLoading, isValidating, mutate } = useSWR<
    StockHistorySuccessResponse,
    Error
  >(
    fetchUrl,
    (url: string) =>
      fetchStockHistory(url).then((response) =>
        requestIdentity
          ? normalizeResponseForIdentity(response, requestIdentity)
          : normalizeHistoryResponse(response)
      ),
    {
      revalidateOnFocus: false,
      errorRetryCount: 1,
      fallbackData:
        initialData &&
        requestIdentity &&
        matchesHistoryRequestIdentity(initialData, requestIdentity)
          ? normalizeHistoryResponse(initialData)
          : undefined,
      keepPreviousData: false,
    }
  )

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  const runSilentRefresh = useCallback(async () => {
    if (
      !fetchUrl ||
      inFlightRefreshRef.current ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return
    }

    const controller = new AbortController()
    inFlightRefreshRef.current = controller
    setIsSilentRefreshing(true)
    setRefreshError(null)

    try {
      const response = await fetchStockHistory(fetchUrl, {
        signal: controller.signal,
      })
      const nextData = requestIdentity
        ? normalizeResponseForIdentity(response, requestIdentity)
        : normalizeHistoryResponse(response)

      await mutate(nextData, {
        populateCache: true,
        revalidate: false,
      })
    } catch (err: unknown) {
      if (!isAbortError(err) && isMountedRef.current) {
        setRefreshError({
          error: err instanceof Error ? err : new Error(String(err)),
          key: fetchUrl,
        })
      }
    } finally {
      if (inFlightRefreshRef.current === controller) {
        inFlightRefreshRef.current = null
      }
      if (isMountedRef.current) {
        setIsSilentRefreshing(false)
      }
    }
  }, [fetchUrl, mutate, requestIdentity])

  useEffect(() => {
    return () => {
      inFlightRefreshRef.current?.abort()
      inFlightRefreshRef.current = null
    }
  }, [fetchUrl])

  useEffect(() => {
    if (!fetchUrl) {
      return
    }

    const intervalId = window.setInterval(() => {
      void runSilentRefresh()
    }, normalizedRefreshIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fetchUrl, normalizedRefreshIntervalMs, runSilentRefresh])

  useEffect(() => {
    if (!fetchUrl) {
      return
    }

    let lastForegroundRefreshAt = 0

    function refreshOnForeground() {
      if (document.hidden || Date.now() - lastForegroundRefreshAt < 1_000) {
        return
      }

      lastForegroundRefreshAt = Date.now()
      void runSilentRefresh()
    }

    document.addEventListener('visibilitychange', refreshOnForeground)
    window.addEventListener('focus', refreshOnForeground)

    return () => {
      document.removeEventListener('visibilitychange', refreshOnForeground)
      window.removeEventListener('focus', refreshOnForeground)
    }
  }, [fetchUrl, runSilentRefresh])

  const points = data?.data ?? []
  const hasData = data !== undefined
  const activeRefreshError =
    fetchUrl && refreshError?.key === fetchUrl ? refreshError.error : null
  const viewStatus: 'loading' | 'error' | 'empty' | 'success' = isLoading && !hasData
    ? 'loading'
    : error && !hasData
      ? 'error'
      : points.length === 0
        ? 'empty'
        : 'success'

  return {
    points,
    fetchedAt: data?.fetchedAt,
    meta: data?.meta,
    servedAt: data?.servedAt,
    error: activeRefreshError ?? error,
    isLoading: viewStatus === 'loading',
    isRefreshing:
      (isValidating || isSilentRefreshing) && hasData && !error,
    viewStatus,
  }
}
