import { useMemo } from 'react';
import useSWR from 'swr';
import { type MarketDataPanelKey } from '@/lib/market';
import { getMarketPanelOption } from '@/features/dashboard/panel/marketPanelOptions';
import { mapPanelTituloToStockProps } from '@/features/dashboard/stocks/panelTitleToStock';
import {
  fetchMarketPanel,
  type MarketPanelSuccessResponse,
} from './marketPanelClient';
import { useRefreshableSWR } from './useRefreshableSWR';

export type MarketPanelViewStatus = 'loading' | 'error' | 'empty' | 'success';

type UseMarketPanelOptions = {
  enabled?: boolean;
  initialData?: MarketPanelSuccessResponse;
  initialErrorMessage?: string;
  initialPanelKey?: MarketDataPanelKey;
};

export function useMarketPanel(
  activePanelKey: MarketDataPanelKey,
  options: UseMarketPanelOptions = {},
) {
  const activePanel = getMarketPanelOption(activePanelKey);
  const isEnabled = options.enabled ?? true;
  const fetchUrl = isEnabled ? (activePanel.fetchUrl ?? null) : null;

  if (!fetchUrl && isEnabled) {
    throw new Error(`Panel de datos sin fetchUrl: ${activePanelKey}`);
  }
  const initialData =
    options.initialPanelKey === activePanelKey ? options.initialData : undefined;
  const initialErrorMessage =
    options.initialPanelKey === activePanelKey
      ? options.initialErrorMessage
      : undefined;

  const { data, error, isLoading, isValidating, mutate } = useSWR<
    MarketPanelSuccessResponse,
    Error
  >(
    fetchUrl,
    fetchMarketPanel,
    {
      fallbackData: initialData,
      revalidateOnFocus: false,
      revalidateOnMount: fetchUrl !== null && initialData === undefined,
      // SWR keeps current-key data while revalidating. Keeping this false avoids
      // rendering the previous panel's rows after the user switches panels.
      keepPreviousData: false,
      errorRetryCount: 1,
    },
  );

  const {
    activeRefreshError,
    isRefreshInFlight,
    refresh,
  } = useRefreshableSWR({
    fetcher: fetchMarketPanel,
    key: fetchUrl,
    mutate,
  });

  const rows = useMemo(
    () =>
      (data?.data ?? []).map((item) =>
        mapPanelTituloToStockProps(item, data?.fetchedAt ?? data?.servedAt)
      ),
    [data],
  );
  const hasData = data !== undefined;
  const hasRows = rows.length > 0;
  const initialError =
    !hasData && !error && initialErrorMessage
      ? new Error(initialErrorMessage)
      : null;
  const displayError = activeRefreshError ?? error ?? initialError;
  const hasError = !!displayError;
  const isActivePanelRefreshing =
    !!fetchUrl &&
    (isRefreshInFlight || (isValidating && hasData && !hasError));
  const viewStatus: MarketPanelViewStatus = !fetchUrl
    ? 'empty'
    : hasError && !hasData
      ? 'error'
      : isLoading && !hasData
        ? 'loading'
        : !hasRows
          ? 'empty'
          : 'success';

  return {
    activePanel,
    rows,
    error: displayError,
    fetchedAt: data?.fetchedAt,
    servedAt: data?.servedAt,
    cacheStatus: data?.cacheStatus,
    stale: data?.stale ?? false,
    staleUntil: data?.staleUntil,
    refresh,
    viewStatus,
    isInitialLoading: viewStatus === 'loading',
    isRefreshing: isActivePanelRefreshing,
    hasError,
    hasStaleError: hasError && hasData,
    isErrorWithoutData: viewStatus === 'error',
    isEmpty: viewStatus === 'empty',
  };
}
