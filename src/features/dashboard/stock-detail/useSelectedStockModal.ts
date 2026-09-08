'use client';

import { useCallback, useMemo, useState } from 'react';
import { resolveSelectedStock } from '@/features/dashboard/panel/panelState';
import { type StockData } from '@/features/dashboard/shared/stockData';

type UseSelectedStockModalOptions = {
  rows: StockData[];
  isFavoritesPanel: boolean;
  favoriteSnapshotsByTicker: Record<string, StockData>;
};

export function useSelectedStockModal({
  rows,
  isFavoritesPanel,
  favoriteSnapshotsByTicker,
}: UseSelectedStockModalOptions) {
  const [selectedSnapshot, setSelectedSnapshot] = useState<StockData | null>(null);

  const resolvedSelectedStock = useMemo(
    () =>
      resolveSelectedStock({
        rows,
        selectedTicker: selectedSnapshot?.ticker ?? null,
        isFavoritesPanel,
        favoriteSnapshotsByTicker,
      }),
    [favoriteSnapshotsByTicker, isFavoritesPanel, rows, selectedSnapshot],
  );

  const selectedStock = resolvedSelectedStock ?? (isFavoritesPanel ? selectedSnapshot : null);

  const handleStockSelect = useCallback((stock: StockData) => {
    setSelectedSnapshot(stock);
  }, []);

  const handleCloseStockDetails = useCallback(() => {
    setSelectedSnapshot(null);
  }, []);

  return {
    selectedStock,
    handleStockSelect,
    handleCloseStockDetails,
    clearSelectedStock: handleCloseStockDetails,
  };
}
