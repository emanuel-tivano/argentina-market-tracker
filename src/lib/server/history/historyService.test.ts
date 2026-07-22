import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = process.env

function setRequiredEnv(
  nodeEnv: NodeJS.ProcessEnv['NODE_ENV'] = 'test',
  overrides: Record<string, string | undefined> = {}
) {
  process.env = {
    ...OLD_ENV,
    API_URL: 'https://api.example.test',
    TOKEN_ENDPOINT: 'token',
    API_USERNAME: 'user',
    API_PASSWORD: 'password',
    MARKET_DATA_SOURCE: 'live',
    ...overrides,
    NODE_ENV: nodeEnv,
  }
}

async function loadHistoryService(iolFetch: ReturnType<typeof vi.fn>) {
  vi.resetModules()
  setRequiredEnv()
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    iolFetch,
    isRecoverableIolUpstreamError: (error: unknown) =>
      error instanceof Error && !(error instanceof TypeError),
  }))

  return import('./historyService')
}

describe('historyService', () => {
  beforeEach(() => {
    setRequiredEnv()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-07T15:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = OLD_ENV
  })

  it('returns stale cached history when the upstream fails after a previous success', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
      .mockRejectedValueOnce(new Error('upstream offline'))
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    const fresh = await getOrCreateHistoryResponse('GGAL', 'bCBA', '1W', {
      requestId: 'req-12345678',
    })

    expect(fresh.meta.stale).toBe(false)

    vi.setSystemTime(new Date('2026-05-07T15:05:01.000Z'))

    const stale = await getOrCreateHistoryResponse('GGAL', 'bCBA', '1W', {
      requestId: 'req-12345678',
    })

    expect(stale.ok).toBe(true)
    expect(stale.cacheStatus).toBe('stale')
    expect(stale.meta.stale).toBe(true)
    expect(stale.data).toEqual([{ date: '2026-05-07', close: 101 }])
    const { observabilityTestExports } = await import(
      '@/lib/server/core/observability'
    )
    const snapshot = observabilityTestExports.getObservabilitySnapshot()

    expect(snapshot.counters).toContainEqual(
      expect.objectContaining({
        name: 'history.response.total',
        tags: expect.objectContaining({ cacheStatus: 'stale', stale: 'true' }),
      })
    )
    expect(snapshot.counters).not.toContainEqual(
      expect.objectContaining({
        name: 'history.response.total',
        tags: expect.objectContaining({
          cacheStatus: 'memory-cache',
          stale: 'true',
        }),
      })
    )
    expect(consoleWarn).toHaveBeenCalledWith(
      '[history.stale-fallback]',
      expect.objectContaining({
        level: 'warn',
        requestId: 'req-12345678',
        symbol: 'GGAL',
        cachedPoints: 1,
      })
    )
  })

  it('propagates a TypeError instead of hiding it with stale history', async () => {
    const programmingFailure = new TypeError('broken history invariant')
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
      .mockRejectedValueOnce(programmingFailure)
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    await getOrCreateHistoryResponse('GGAL', 'bCBA', '1W')
    vi.setSystemTime(new Date('2026-05-07T15:05:01.000Z'))

    await expect(
      getOrCreateHistoryResponse('GGAL', 'bCBA', '1W')
    ).rejects.toBe(programmingFailure)
  })

  it('uses stale for a typed invalid upstream history response', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
      .mockResolvedValueOnce({ invalid: true })
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    await getOrCreateHistoryResponse('GGAL', 'bCBA', '1W')
    vi.setSystemTime(new Date('2026-05-07T15:05:01.000Z'))

    const stale = await getOrCreateHistoryResponse('GGAL', 'bCBA', '1W')
    expect(stale.meta.stale).toBe(true)
  })
})
