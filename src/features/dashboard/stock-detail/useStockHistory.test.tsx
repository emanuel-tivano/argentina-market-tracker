// @vitest-environment jsdom
import { SWRConfig } from 'swr'
import { type ReactNode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type StockHistoryRange,
  type StockHistorySuccessResponse,
} from '@/lib/stockHistory'
import {
  normalizeLiveHistoryPoints,
  normalizeStockHistoryRefreshIntervalMs,
  STOCK_HISTORY_REFRESH_INTERVAL_MS,
  useStockHistory,
} from './useStockHistory'

const mocks = vi.hoisted(() => ({
  fetchStockHistory: vi.fn(),
}))

vi.mock('./stockHistoryClient', () => ({
  fetchStockHistory: mocks.fetchStockHistory,
}))

function renderWithSWR(ui: ReactNode) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    ),
  })
}

function HistoryProbe({
  symbol,
  range = '1M',
  market,
  enabled = true,
  refreshIntervalMs,
}: {
  symbol: string
  range?: StockHistoryRange
  market?: string
  enabled?: boolean
  refreshIntervalMs?: number
}) {
  const history = useStockHistory(symbol, range, market, {
    enabled,
    refreshIntervalMs,
  })

  return (
    <>
      <output>
        {history.viewStatus}:{history.points.length}:{history.error?.message ?? ''}
      </output>
      <span data-testid="history-close">{history.points[0]?.close ?? ''}</span>
    </>
  )
}

function historyResponse(
  points = [{ date: '2026-05-01', close: 100 }],
  identity: Partial<
    Pick<StockHistorySuccessResponse, 'market' | 'range' | 'symbol'>
  > = {}
): StockHistorySuccessResponse {
  return {
    ok: true as const,
    data: points,
    fetchedAt: '2026-05-04T16:00:00.000Z',
    servedAt: '2026-05-04T16:00:00.000Z',
    cacheStatus: 'fresh' as const,
    range: identity.range ?? '1M',
    market: identity.market ?? 'bCBA',
    symbol: identity.symbol ?? 'GGAL',
    meta: {
      discardedPoints: 0,
      source: 'demo' as const,
      stale: false,
      totalPoints: points.length,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

describe('useStockHistory', () => {
  afterEach(() => {
    cleanup()
    mocks.fetchStockHistory.mockReset()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not fetch when the symbol is missing', () => {
    renderWithSWR(<HistoryProbe symbol="   " />)

    expect(screen.getByText('empty:0:')).not.toBeNull()
    expect(mocks.fetchStockHistory).not.toHaveBeenCalled()
  })

  it('does not fetch when disabled', () => {
    renderWithSWR(<HistoryProbe symbol="GGAL" enabled={false} />)

    expect(screen.getByText('empty:0:')).not.toBeNull()
    expect(mocks.fetchStockHistory).not.toHaveBeenCalled()
  })

  it('uses a stable encoded SWR key for valid inputs', async () => {
    mocks.fetchStockHistory.mockReturnValue(new Promise(() => undefined))

    renderWithSWR(<HistoryProbe symbol=" GGAL " range="1W" market=" bCBA " />)

    await waitFor(() => {
      expect(mocks.fetchStockHistory).toHaveBeenCalledWith(
        '/api/stocks/GGAL/history?range=1W&market=bCBA'
      )
    })
    expect(screen.getByText('loading:0:')).not.toBeNull()
  })

  it('does not expose the previous range while the active range loads', async () => {
    const nextRange = deferred<StockHistorySuccessResponse>()
    mocks.fetchStockHistory
      .mockResolvedValueOnce(historyResponse([{ date: '2026-05-01', close: 101 }]))
      .mockReturnValueOnce(nextRange.promise)

    const view = renderWithSWR(<HistoryProbe symbol="GGAL" range="1M" />)
    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())
    expect(screen.getByTestId('history-close').textContent).toBe('101')

    view.rerender(<HistoryProbe symbol="GGAL" range="1Y" />)

    await waitFor(() => expect(screen.getByText('loading:0:')).not.toBeNull())
    expect(screen.getByTestId('history-close').textContent).toBe('')

    await act(async () => {
      nextRange.resolve(
        historyResponse([{ date: '2026-05-02', close: 202 }], { range: '1Y' })
      )
    })

    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())
    expect(screen.getByTestId('history-close').textContent).toBe('202')
  })

  it('ignores out-of-order responses across rapid range changes', async () => {
    const oneWeek = deferred<StockHistorySuccessResponse>()
    const oneMonth = deferred<StockHistorySuccessResponse>()
    const oneYear = deferred<StockHistorySuccessResponse>()
    mocks.fetchStockHistory.mockImplementation((url: string) => {
      if (url.includes('range=1W')) return oneWeek.promise
      if (url.includes('range=1M')) return oneMonth.promise
      return oneYear.promise
    })

    const view = renderWithSWR(<HistoryProbe symbol="GGAL" range="1W" />)
    view.rerender(<HistoryProbe symbol="GGAL" range="1M" />)
    view.rerender(<HistoryProbe symbol="GGAL" range="1Y" />)

    await act(async () => {
      oneYear.resolve(
        historyResponse([{ date: '2026-05-03', close: 301 }], { range: '1Y' })
      )
    })
    await waitFor(() => expect(screen.getByTestId('history-close').textContent).toBe('301'))

    await act(async () => {
      oneMonth.resolve(
        historyResponse([{ date: '2026-05-02', close: 201 }], { range: '1M' })
      )
      oneWeek.resolve(
        historyResponse([{ date: '2026-05-01', close: 101 }], { range: '1W' })
      )
    })

    expect(screen.getByTestId('history-close').textContent).toBe('301')
  })

  it('does not expose data from the previous symbol', async () => {
    const nextSymbol = deferred<StockHistorySuccessResponse>()
    mocks.fetchStockHistory
      .mockResolvedValueOnce(historyResponse([{ date: '2026-05-01', close: 100 }]))
      .mockReturnValueOnce(nextSymbol.promise)

    const view = renderWithSWR(<HistoryProbe symbol="GGAL" />)
    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())

    view.rerender(<HistoryProbe symbol="YPFD" />)

    await waitFor(() => expect(screen.getByText('loading:0:')).not.toBeNull())
    expect(screen.getByTestId('history-close').textContent).toBe('')

    await act(async () => {
      nextSymbol.resolve(
        historyResponse([{ date: '2026-05-02', close: 500 }], { symbol: 'YPFD' })
      )
    })
    await waitFor(() => expect(screen.getByTestId('history-close').textContent).toBe('500'))
  })

  it('shows the new range error without retaining old statistics', async () => {
    mocks.fetchStockHistory
      .mockResolvedValueOnce(historyResponse([{ date: '2026-05-01', close: 100 }]))
      .mockRejectedValue(new Error('new range failed'))

    const view = renderWithSWR(<HistoryProbe symbol="GGAL" range="1M" />)
    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())

    view.rerender(<HistoryProbe symbol="GGAL" range="1Y" />)

    await waitFor(() =>
      expect(screen.getByText('error:0:new range failed')).not.toBeNull()
    )
    expect(screen.getByTestId('history-close').textContent).toBe('')
  })

  it('rejects a response whose identity differs from the active request', async () => {
    mocks.fetchStockHistory.mockResolvedValue(
      historyResponse([{ date: '2026-05-01', close: 100 }], { range: '1W' })
    )

    renderWithSWR(<HistoryProbe symbol="GGAL" range="1Y" />)

    await waitFor(() =>
      expect(
        screen.getByText(
          'error:0:La respuesta histórica no coincide con la solicitud activa.'
        )
      ).not.toBeNull()
    )
  })

  it('polls while enabled and visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    mocks.fetchStockHistory.mockResolvedValue(historyResponse())

    renderWithSWR(<HistoryProbe symbol="GGAL" />)

    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())

    await act(async () => {
      vi.advanceTimersByTime(STOCK_HISTORY_REFRESH_INTERVAL_MS)
    })

    await waitFor(() => expect(mocks.fetchStockHistory).toHaveBeenCalledTimes(2))
    expect(mocks.fetchStockHistory).toHaveBeenLastCalledWith(
      '/api/stocks/GGAL/history?range=1M&market=bCBA',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('does not start overlapping polling requests', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    let resolveRefresh: (value: ReturnType<typeof historyResponse>) => void
    mocks.fetchStockHistory
      .mockResolvedValueOnce(historyResponse())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          })
      )

    renderWithSWR(<HistoryProbe symbol="GGAL" />)

    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())

    await act(async () => {
      vi.advanceTimersByTime(STOCK_HISTORY_REFRESH_INTERVAL_MS)
      vi.advanceTimersByTime(STOCK_HISTORY_REFRESH_INTERVAL_MS)
    })

    expect(mocks.fetchStockHistory).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveRefresh!(historyResponse([{ date: '2026-05-02', close: 101 }]))
    })
  })

  it('aborts in-flight polling on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    mocks.fetchStockHistory
      .mockResolvedValueOnce(historyResponse())
      .mockImplementationOnce(() => new Promise(() => undefined))

    const view = renderWithSWR(<HistoryProbe symbol="GGAL" />)

    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())

    await act(async () => {
      vi.advanceTimersByTime(STOCK_HISTORY_REFRESH_INTERVAL_MS)
    })

    const signal = mocks.fetchStockHistory.mock.calls[1]?.[1]?.signal

    view.unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('keeps previous data when a polling refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    mocks.fetchStockHistory
      .mockResolvedValueOnce(historyResponse([{ date: '2026-05-01', close: 100 }]))
      .mockRejectedValueOnce(new Error('refresh failed'))

    renderWithSWR(<HistoryProbe symbol="GGAL" />)

    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())

    await act(async () => {
      vi.advanceTimersByTime(STOCK_HISTORY_REFRESH_INTERVAL_MS)
    })

    await waitFor(() =>
      expect(screen.getByText('success:1:refresh failed')).not.toBeNull()
    )
  })

  it('refreshes once when the window gets focus', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    let focusListener: EventListener | null = null
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type, listener) => {
        if (type === 'focus') {
          focusListener = listener as EventListener
        }
      }
    )
    mocks.fetchStockHistory.mockResolvedValue(historyResponse())

    renderWithSWR(<HistoryProbe symbol="GGAL" />)

    await waitFor(() => expect(screen.getByText('success:1:')).not.toBeNull())

    await act(async () => {
      expect(focusListener).not.toBeNull()
      focusListener?.(new Event('focus'))
    })

    await waitFor(() => expect(mocks.fetchStockHistory).toHaveBeenCalledTimes(2))
  })

  it('falls back to a finite interval for invalid configuration', () => {
    expect(normalizeStockHistoryRefreshIntervalMs(Number.NaN)).toBe(
      STOCK_HISTORY_REFRESH_INTERVAL_MS
    )
    expect(normalizeStockHistoryRefreshIntervalMs(Number.POSITIVE_INFINITY)).toBe(
      STOCK_HISTORY_REFRESH_INTERVAL_MS
    )
    expect(normalizeStockHistoryRefreshIntervalMs(0)).toBe(
      STOCK_HISTORY_REFRESH_INTERVAL_MS
    )
    expect(normalizeStockHistoryRefreshIntervalMs(30_000)).toBe(30_000)
  })

  it('clears its polling timer on unmount', () => {
    mocks.fetchStockHistory.mockReturnValue(new Promise(() => undefined))
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const view = renderWithSWR(<HistoryProbe symbol="GGAL" />)

    view.unmount()

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('deduplicates points by timestamp and sorts them chronologically', () => {
    expect(
      normalizeLiveHistoryPoints([
        { date: '2026-05-03', close: 103 },
        { date: '2026-05-01', close: 101 },
        { date: '2026-05-02', timestamp: '2026-05-02T20:00:00.000Z', close: 102 },
        { date: '2026-05-02', timestamp: '2026-05-02T20:00:00.000Z', close: 202 },
      ])
    ).toEqual([
      { date: '2026-05-01', close: 101 },
      { date: '2026-05-02', timestamp: '2026-05-02T20:00:00.000Z', close: 202 },
      { date: '2026-05-03', close: 103 },
    ])
  })
})
