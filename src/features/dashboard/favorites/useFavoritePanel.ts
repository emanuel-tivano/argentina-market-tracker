import { useMemo } from 'react'
import useSWR from 'swr'
import { buildFavoritesApiPath, type FavoriteStockIdentity } from '@/lib/favorites'
import { mapPanelTituloToStockProps } from '@/features/dashboard/stocks/panelTitleToStock'
import {
  fetchFavoritePanel,
  type FavoritePanelSuccessResponse,
} from './favoritePanelClient'
import { type MarketPanelViewStatus } from '@/features/dashboard/panel/useMarketPanel'
import { useRefreshableSWR } from '@/features/dashboard/panel/useRefreshableSWR'

export type UseFavoritePanelOptions = {
  enabled?: boolean
}

export function useFavoritePanel(
  items: FavoriteStockIdentity[],
  options: UseFavoritePanelOptions = {}
) {
  const isEnabled = options.enabled ?? true
  const fetchUrl = useMemo(
    () => (isEnabled && items.length > 0 ? buildFavoritesApiPath(items) : null),
    [isEnabled, items]
  )

  const { data, error, isLoading, isValidating, mutate } = useSWR<
    FavoritePanelSuccessResponse,
    Error
  >(fetchUrl, fetchFavoritePanel, {
    revalidateOnFocus: false,
    revalidateOnMount: fetchUrl !== null,
    keepPreviousData: false,
    errorRetryCount: 1,
  })

  const {
    activeRefreshError,
    isRefreshInFlight,
    refresh,
  } = useRefreshableSWR({
    fetcher: fetchFavoritePanel,
    key: fetchUrl,
    mutate,
  })

  const rows = useMemo(
    () =>
      (data?.rows ?? []).map((item) =>
        mapPanelTituloToStockProps(item, data?.updatedAt ?? data?.servedAt)
      ),
    [data]
  )
  const hasData = data !== undefined
  const hasRows = rows.length > 0
  const displayError = activeRefreshError ?? error ?? null
  const hasError = !!displayError
  const isRefreshing =
    !!fetchUrl &&
    (isRefreshInFlight || (isValidating && hasData && !hasError))
  const viewStatus: MarketPanelViewStatus = !fetchUrl
    ? 'empty'
    : hasError && !hasData
      ? 'error'
      : isLoading && !hasData
        ? 'loading'
        : !hasRows
          ? 'empty'
          : 'success'

  return {
    rows,
    error: displayError,
    fetchedAt: data?.updatedAt,
    servedAt: data?.servedAt,
    refresh,
    viewStatus,
    isRefreshing,
    hasStaleError: hasError && hasData,
    missingItems: data?.missingItems ?? [],
    failedItems: data?.failedItems ?? [],
    source: data?.source,
    stale: data?.stale ?? false,
  }
}
