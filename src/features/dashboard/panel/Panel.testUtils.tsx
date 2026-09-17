import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { expect, vi } from 'vitest'
import Panel from './Panel'
import { type FavoritesSuccessResponse } from '@/lib/favorites'
import { type MarketDataPanelKey } from '@/lib/market'
import { type PanelSuccessResponse, type PanelTitulo } from '@/lib/panel'

const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

export const push = navigationMock.push
export const replace = navigationMock.replace

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push, replace }),
  useSearchParams: () => navigationMock.searchParams,
}))

vi.mock('@/features/dashboard/stock-detail/useStockHistory', () => ({
  useStockHistory: () => ({
    points: [],
    error: undefined,
    isLoading: false,
    isRefreshing: false,
    viewStatus: 'empty',
  }),
}))

vi.mock('@/features/dashboard/stock-detail/useStockQuote', () => ({
  useStockQuote: () => ({
    quote: null,
    source: null,
  }),
}))

export function setCurrentSearchParams(value: string) {
  navigationMock.searchParams = new URLSearchParams(value)
}

export function panelResponse(
  data: PanelTitulo[],
  overrides: Partial<PanelSuccessResponse> = {}
) {
  return {
    ok: true,
    data,
    fetchedAt: '2026-05-04T16:00:00.000Z',
    servedAt: '2026-05-04T16:00:00.000Z',
    staleUntil: '2026-05-04T16:02:00.000Z',
    cacheStatus: 'fresh',
    stale: false,
    ...overrides,
  } satisfies PanelSuccessResponse
}

export function favoritesResponse(
  rows: PanelTitulo[],
  overrides: Partial<FavoritesSuccessResponse> = {}
) {
  return {
    ok: true,
    rows,
    missingItems: [],
    failedItems: [],
    source: 'live',
    requestId: 'req-favorites-1234',
    updatedAt: '2026-05-04T16:00:00.000Z',
    servedAt: '2026-05-04T16:00:00.000Z',
    stale: false,
    ...overrides,
  } satisfies FavoritesSuccessResponse
}

export function renderPanel(props?: {
  initialData?: PanelSuccessResponse
  initialErrorMessage?: string
  initialPanelKey?: MarketDataPanelKey
  isDemoMode?: boolean
}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Panel {...props} />
    </SWRConfig>
  )
}

export function renderPanelView() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Panel />
    </SWRConfig>
  )
}

export function renderedTickers() {
  return Array.from(document.querySelectorAll('tbody tr[data-symbol]')).map(
    (row) => row.getAttribute('data-symbol')
  )
}

export async function tabUntilFocus(target: HTMLElement, maxTabs = 20) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (document.activeElement === target) {
      return
    }

    await userEvent.tab()
  }

  throw new Error(`Could not focus target after ${maxTabs} tabs`)
}

export function mockAutoRefreshInterval() {
  let intervalCallback: (() => void) | undefined

  vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
    if (delay === 60_000) {
      intervalCallback = () => {
        if (typeof callback === 'function') {
          callback()
        }
      }
    }

    return 1 as unknown as ReturnType<typeof window.setInterval>
  })
  vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined)

  return async function triggerAutoRefresh() {
    expect(intervalCallback).toBeDefined()

    await act(async () => {
      intervalCallback?.()
    })
  }
}

export function setupPanelTest() {
  navigationMock.searchParams = new URLSearchParams()
  push.mockClear()
  replace.mockClear()
  window.localStorage.clear()
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(
    this: HTMLDialogElement
  ) {
    this.setAttribute('open', '')
  })
  HTMLDialogElement.prototype.close = vi.fn(function close(
    this: HTMLDialogElement
  ) {
    this.removeAttribute('open')
  })
}

export function cleanupPanelTest() {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

export { screen }
