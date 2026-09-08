'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { type MarketDataPanelKey } from '@/lib/market';
import {
  normalizeFavoriteIdentities,
  normalizeFavoriteSymbol,
  type FavoriteStockIdentity,
} from '@/lib/favorites';
import { DEFAULT_STOCK_HISTORY_MARKET } from '@/lib/stockHistory';
import { type StockData } from '@/features/dashboard/shared/stockData';
import { normalizeTicker } from '@/features/dashboard/shared/ticker';

export const FAVORITE_STOCKS_STORAGE_KEY =
  'argentina-market-tracker:favorites';
export const FAVORITE_STOCK_SNAPSHOTS_STORAGE_KEY =
  'argentina-market-tracker:favorite-stock-snapshots';

type SafeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ToggleFavoriteOptions = {
  market?: FavoriteStockIdentity['market'];
  sourcePanel?: MarketDataPanelKey;
};

type FavoriteStocksState = {
  items: FavoriteStockIdentity[];
  snapshotsByTicker: Record<string, StockData>;
  didLoad: boolean;
};

function getStorage(): SafeStorage | null {
  try {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
      return null;
    }

    return window.localStorage;
  } catch {
    return null;
  }
}

function safeGetStorageItem(key: string): string | null {
  const storage = getStorage();

  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorageItem(key: string, value: string) {
  const storage = getStorage();

  if (!storage) return;

  try {
    storage.setItem(key, value);
  } catch {
    // Favorites should keep working even when storage is blocked or full.
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isVariationType(value: unknown): value is StockData['varType'] {
  return value === 'positive' || value === 'negative' || value === 'neutral';
}

function normalizeFavoriteSnapshot(value: unknown): StockData | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const ticker =
    typeof record.ticker === 'string' ? normalizeTicker(record.ticker) : '';
  const description =
    typeof record.description === 'string' ? record.description : '';

  if (!ticker) return null;

  return {
    ticker,
    description,
    price: numberOrNull(record.price),
    var: numberOrNull(record.var),
    varType: isVariationType(record.varType) ? record.varType : 'neutral',
    buyQty: numberOrNull(record.buyQty),
    buyPrice: numberOrNull(record.buyPrice),
    sellPrice: numberOrNull(record.sellPrice),
    sellQty: numberOrNull(record.sellQty),
    open: numberOrNull(record.open),
    min: numberOrNull(record.min),
    max: numberOrNull(record.max),
    close: numberOrNull(record.close),
    volume: numberOrNull(record.volume),
  };
}

function readStoredFavorites(): FavoriteStockIdentity[] {
  const storedValue = safeGetStorageItem(FAVORITE_STOCKS_STORAGE_KEY);

  if (!storedValue) return [];

  try {
    return normalizeFavoriteIdentities(JSON.parse(storedValue));
  } catch {
    return [];
  }
}

function normalizeFavoriteSnapshots(value: unknown): Record<string, StockData> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const snapshots: Record<string, StockData> = {};

  for (const item of Object.values(value)) {
    const snapshot = normalizeFavoriteSnapshot(item);

    if (snapshot) {
      snapshots[snapshot.ticker] = snapshot;
    }
  }

  return snapshots;
}

function readStoredFavoriteSnapshots(): Record<string, StockData> {
  const storedValue = safeGetStorageItem(FAVORITE_STOCK_SNAPSHOTS_STORAGE_KEY);

  if (!storedValue) return {};

  try {
    return normalizeFavoriteSnapshots(JSON.parse(storedValue));
  } catch {
    return {};
  }
}

function toggleFavoriteIdentity(
  items: FavoriteStockIdentity[],
  symbol: string,
  options: ToggleFavoriteOptions,
) {
  const existingIndex = items.findIndex((item) => item.symbol === symbol);
  const isRemoving = existingIndex >= 0;
  const nextItems = isRemoving
    ? items.filter((_, index) => index !== existingIndex)
    : [
        ...items,
        {
          symbol,
          market: options.market ?? DEFAULT_STOCK_HISTORY_MARKET,
          ...(options.sourcePanel ? { sourcePanel: options.sourcePanel } : {}),
        },
      ];

  return {
    isRemoving,
    items: nextItems.sort((left, right) =>
      left.symbol.localeCompare(right.symbol),
    ),
  };
}

export function useFavoriteStocks() {
  const [state, setState] = useState<FavoriteStocksState>({
    items: [],
    snapshotsByTicker: {},
    didLoad: false,
  });
  const {
    items: favoriteItems,
    snapshotsByTicker: favoriteSnapshotsByTicker,
    didLoad,
  } = state;

  useEffect(() => {
    // localStorage is only available after client mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      items: readStoredFavorites(),
      snapshotsByTicker: readStoredFavoriteSnapshots(),
      didLoad: true,
    });
  }, []);

  useEffect(() => {
    if (!didLoad) return;

    safeSetStorageItem(
      FAVORITE_STOCKS_STORAGE_KEY,
      JSON.stringify(favoriteItems),
    );
    safeSetStorageItem(
      FAVORITE_STOCK_SNAPSHOTS_STORAGE_KEY,
      JSON.stringify(favoriteSnapshotsByTicker),
    );
  }, [didLoad, favoriteItems, favoriteSnapshotsByTicker]);

  const favorites = useMemo(
    () => favoriteItems.map((item) => item.symbol),
    [favoriteItems]
  );
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback(
    (ticker: string) => favoriteSet.has(normalizeTicker(ticker)),
    [favoriteSet],
  );

  const toggleFavorite = useCallback((
    ticker: string,
    options: ToggleFavoriteOptions = {},
  ) => {
    const normalizedTicker = normalizeFavoriteSymbol(ticker);

    if (!normalizedTicker) return;

    setState((current) => ({
      ...current,
      items: toggleFavoriteIdentity(current.items, normalizedTicker, options)
        .items,
    }));
  }, []);

  const addFavoriteSnapshot = useCallback((stock: StockData) => {
    const snapshot = normalizeFavoriteSnapshot(stock);

    if (!snapshot) return;

    setState((current) => ({
      ...current,
      snapshotsByTicker: {
        ...current.snapshotsByTicker,
        [snapshot.ticker]: snapshot,
      },
    }));
  }, []);

  const removeFavoriteSnapshot = useCallback((ticker: string) => {
    const normalizedTicker = normalizeTicker(ticker);

    if (!normalizedTicker) return;

    setState((current) => {
      if (!(normalizedTicker in current.snapshotsByTicker)) return current;

      const snapshotsByTicker = { ...current.snapshotsByTicker };

      delete snapshotsByTicker[normalizedTicker];

      return { ...current, snapshotsByTicker };
    });
  }, []);

  const toggleFavoriteStock = useCallback((
    stock: StockData,
    options: ToggleFavoriteOptions = {},
  ) => {
    const snapshot = normalizeFavoriteSnapshot(stock);

    if (!snapshot) return;

    setState((current) => {
      const { items, isRemoving } = toggleFavoriteIdentity(
        current.items,
        snapshot.ticker,
        options,
      );
      const snapshotsByTicker = { ...current.snapshotsByTicker };

      if (isRemoving) {
        delete snapshotsByTicker[snapshot.ticker];
      } else {
        snapshotsByTicker[snapshot.ticker] = snapshot;
      }

      return { ...current, items, snapshotsByTicker };
    });
  }, []);

  return {
    favorites,
    favoriteItems,
    favoriteSet,
    favoriteSnapshotsByTicker,
    addFavoriteSnapshot,
    isFavorite,
    removeFavoriteSnapshot,
    toggleFavorite,
    toggleFavoriteStock,
  };
}
