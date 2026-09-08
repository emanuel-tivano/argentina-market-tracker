import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyedMutator } from 'swr'

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 60_000

type UseRefreshableSWROptions<TData> = {
  autoRefreshIntervalMs?: number
  fetcher(url: string): Promise<TData>
  key: string | null
  mutate: KeyedMutator<TData>
}

function unknownToError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err ?? 'unknown'))
}

export function useRefreshableSWR<TData>({
  autoRefreshIntervalMs = DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  fetcher,
  key,
  mutate,
}: UseRefreshableSWROptions<TData>) {
  const refreshInFlightKeysRef = useRef(new Set<string>())
  const lastAutoRefreshAtRef = useRef(0)
  const [refreshingKeys, setRefreshingKeys] = useState<string[]>([])
  const [refreshError, setRefreshError] = useState<{
    key: string
    error: Error
  } | null>(null)

  const setRefreshInFlight = useCallback((nextKey: string, isInFlight: boolean) => {
    const nextKeys = new Set(refreshInFlightKeysRef.current)

    if (isInFlight) {
      nextKeys.add(nextKey)
    } else {
      nextKeys.delete(nextKey)
    }

    refreshInFlightKeysRef.current = nextKeys
    setRefreshingKeys([...nextKeys])
  }, [])

  const runRefresh = useCallback(async (bypassCache: boolean) => {
    if (!key || refreshInFlightKeysRef.current.has(key)) return

    setRefreshInFlight(key, true)
    setRefreshError((currentError) =>
      currentError?.key === key ? null : currentError
    )

    try {
      await mutate(
        () =>
          fetcher(
            bypassCache
              ? `${key}${key.includes('?') ? '&' : '?'}refresh=1`
              : key
          ),
        {
          populateCache: true,
          revalidate: false,
        }
      )
    } catch (err: unknown) {
      const nextError = unknownToError(err)

      setRefreshError({
        key,
        error: nextError,
      })
      throw nextError
    } finally {
      setRefreshInFlight(key, false)
    }
  }, [fetcher, key, mutate, setRefreshInFlight])

  const refresh = useCallback(() => runRefresh(true), [runRefresh])
  const autoRefresh = useCallback(async () => {
    lastAutoRefreshAtRef.current = Date.now()
    await runRefresh(false)
  }, [runRefresh])

  useEffect(() => {
    lastAutoRefreshAtRef.current = Date.now()
  }, [key])

  useEffect(() => {
    if (!key) {
      return
    }

    function tryAutoRefresh() {
      if (document.hidden) {
        return
      }

      void autoRefresh().catch(() => undefined)
    }

    function handleVisibilityChange() {
      if (
        document.hidden ||
        Date.now() - lastAutoRefreshAtRef.current < autoRefreshIntervalMs
      ) {
        return
      }

      void autoRefresh().catch(() => undefined)
    }

    const intervalId = window.setInterval(tryAutoRefresh, autoRefreshIntervalMs)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [autoRefresh, autoRefreshIntervalMs, key])

  return {
    activeRefreshError:
      key && refreshError?.key === key ? refreshError.error : null,
    isRefreshInFlight: !!key && refreshingKeys.includes(key),
    refresh,
  }
}
