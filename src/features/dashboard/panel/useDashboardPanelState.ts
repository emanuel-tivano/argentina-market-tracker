'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  isMarketPanelKey,
  type MarketDataPanelKey,
  type MarketPanelKey,
} from '@/lib/market';
import { setStockSortSearchParams } from '@/features/dashboard/stocks/stockSortPersistence';
import { type StockSort } from '@/features/dashboard/stocks/stockSorting';

type UseDashboardPanelStateOptions = {
  defaultPanel: MarketDataPanelKey;
  sort: StockSort;
};

export function useDashboardPanelState({
  defaultPanel,
  sort,
}: UseDashboardPanelStateOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panelParam = searchParams.get('panel');
  const activePanelKey = isMarketPanelKey(panelParam) ? panelParam : defaultPanel;
  const [favoritesSourcePanelKey, setFavoritesSourcePanelKey] =
    useState<MarketDataPanelKey>(
      activePanelKey === 'favorites' ? defaultPanel : activePanelKey,
    );

  const isFavoritesPanel = activePanelKey === 'favorites';
  const dataPanelKey = isFavoritesPanel
    ? favoritesSourcePanelKey
    : activePanelKey;

  const handlePanelChange = useCallback((key: MarketPanelKey) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (key !== 'favorites') {
      setFavoritesSourcePanelKey(key);
    } else if (activePanelKey !== 'favorites') {
      setFavoritesSourcePanelKey(activePanelKey);
    }

    nextParams.set('panel', key);
    setStockSortSearchParams(nextParams, sort);

    router.replace(`${pathname}?${nextParams.toString()}`, {
      scroll: false,
    });
  }, [activePanelKey, pathname, router, searchParams, sort]);

  return {
    activePanelKey,
    dataPanelKey,
    isFavoritesPanel,
    handlePanelChange,
  };
}
