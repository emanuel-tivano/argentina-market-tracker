import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IolUpstreamHttpError,
  IolUpstreamNetworkError,
  IolUpstreamResponseError,
  IolUpstreamTimeoutError,
  isRecoverableIolUpstreamError,
} from '@/lib/server/upstream/iol'
import { selectPerformanceWindow } from '@/lib/marketPerformance'

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
    isRecoverableIolUpstreamError,
  }))

  return import('./historyService')
}

function upstreamHttpError(status: number): IolUpstreamHttpError {
  return new IolUpstreamHttpError(`upstream HTTP ${status}`, status, {
    statusText: `Status ${status}`,
    upstreamPath: '/history/ajustada',
  })
}

describe('historyService', () => {
  it('derives served daily performance before trimming the reference margin', async () => {
    vi.setSystemTime(new Date('2026-09-23T15:00:00.000Z'))
    const iolFetch = vi.fn().mockResolvedValue([
      {
        fecha: '2026-03-10',
        ultimoPrecio: 5000,
        variacion: 77,
        cierreAnterior: 1,
      },
      {
        fecha: '2026-03-23',
        ultimoPrecio: 5100,
        variacion: 0,
        cierreAnterior: 0,
      },
      {
        fecha: '2026-09-21',
        ultimoPrecio: 6680,
        variacion: 0,
        cierreAnterior: 0,
      },
      {
        fechaHora: '2026-09-22T11:00:00',
        ultimoPrecio: 6500,
        variacion: 50,
        cierreAnterior: 1,
      },
      {
        fechaHora: '2026-09-22T17:00:00',
        ultimoPrecio: 6640,
        variacion: 50,
        cierreAnterior: 1,
        apertura: 6675,
        maximo: 6690,
        minimo: 6600,
        volumenNominal: 1100,
        montoOperado: 7304000,
      },
      {
        fecha: '2026-09-23',
        ultimoPrecio: 6445,
        variacion: 0,
        cierreAnterior: 0,
      },
    ])
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)
    const response = await getOrCreateHistoryResponse('GGAL', 'bCBA', '6M')

    expect(iolFetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v2/bCBA/Titulos/GGAL/Cotizacion/seriehistorica/2026-03-09/2026-09-23/ajustada'
    )
    expect(response.data.map((point) => point.date)).toEqual([
      '2026-03-23',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ])
    expect(response.data[0]).toMatchObject({
      date: '2026-03-23',
      previousClose: 5000,
    })
    expect(response.data[0].dailyVariation).toBeCloseTo(2, 12)
    expect(response.data[2]).toMatchObject({
      date: '2026-09-22',
      timestamp: '2026-09-22T17:00:00',
      close: 6640,
      previousClose: 6680,
      open: 6675,
      high: 6690,
      low: 6600,
      volume: 1100,
      amountTraded: 7304000,
    })
    expect(response.data[2].dailyVariation).toBeCloseTo(-0.5988023952, 10)
    expect(response.data[3]).toMatchObject({
      date: '2026-09-23',
      close: 6445,
      previousClose: 6640,
    })
    expect(response.data[3].dailyVariation).toBeCloseTo(-2.936746988, 10)
    expect(response.meta).toMatchObject({
      invalidPoints: 0,
      duplicatePoints: 1,
      discardedPoints: 1,
      totalPoints: 4,
    })
  })

  it('anchors PAMP 1Y to the last available close instead of the server clock', async () => {
    vi.setSystemTime(new Date('2026-09-18T15:00:00.000Z'))
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: '2025-09-04', ultimoPrecio: 3500 },
      { fecha: '2025-09-17', ultimoPrecio: 3595 },
      { fecha: '2025-09-18', ultimoPrecio: 3520 },
      { fecha: '2026-09-17', ultimoPrecio: 5335 },
    ])
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)
    const response = await getOrCreateHistoryResponse('PAMP', 'bCBA', '1Y')

    expect(iolFetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v2/bCBA/Titulos/PAMP/Cotizacion/seriehistorica/2025-09-04/2026-09-18/ajustada'
    )
    expect(response.data.map((point) => [point.date, point.close])).toEqual([
      ['2025-09-17', 3595],
      ['2025-09-18', 3520],
      ['2026-09-17', 5335],
    ])
    expect(
      selectPerformanceWindow(response.data, '1Y').returnPercentage
    ).toBeCloseTo(48.40055632823365, 12)
  })

  it('calculates long-period returns from one normalized point per trading day', async () => {
    vi.setSystemTime(new Date('2026-05-07T15:00:00.000Z'))
    const iolFetch = vi.fn().mockResolvedValue([
      { fechaHora: '2021-05-07T17:00:00', ultimoPrecio: 100 },
      { fechaHora: '2022-05-17T11:00:00', ultimoPrecio: 140, volumenNominal: 10 },
      { fechaHora: '2022-05-17T17:00:00', ultimoPrecio: 150, volumenNominal: 20 },
      { fechaHora: '2026-05-07T17:00:00', ultimoPrecio: 200 },
    ])
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)
    const response = await getOrCreateHistoryResponse('ALUA', 'bCBA', '5Y')

    expect(response.data).toHaveLength(3)
    expect(response.data.filter((point) => point.date === '2022-05-17')).toEqual([
      expect.objectContaining({ close: 150, volume: 20 }),
    ])
    expect(
      selectPerformanceWindow(response.data, '5Y').returnPercentage
    ).toBeCloseTo(100, 12)
  })

  it.each([false, true])('propagates separate counters through fresh, cached and stale responses (invalid=%s)', async (withInvalid) => {
    const rows: unknown[] = [
      { fechaHora: '2026-05-07T17:00:00', ultimoPrecio: 102 },
      { fechaHora: '2026-05-07T11:00:00', ultimoPrecio: 101 },
    ]
    if (withInvalid) rows.push({ fecha: 'invalid', ultimoPrecio: 99 })
    const iolFetch = vi.fn().mockResolvedValueOnce(rows).mockRejectedValueOnce(new IolUpstreamNetworkError('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)
    const counts = { invalidPoints: withInvalid ? 1 : 0, duplicatePoints: 1, discardedPoints: withInvalid ? 2 : 1, totalPoints: 1 }
    const fresh = await getOrCreateHistoryResponse('ALUA', 'bCBA', '5Y')
    expect(fresh.meta).toMatchObject(counts)
    expect(fresh.data[0].close).toBe(102)
    const cached = await getOrCreateHistoryResponse('ALUA', 'bCBA', '5Y')
    expect(cached).toMatchObject({ cacheStatus: 'memory-cache', meta: counts })
    expect(warn).toHaveBeenCalledWith(
      withInvalid
        ? '[history.normalize.partial]'
        : '[history.normalize.anomaly]',
      expect.objectContaining({
        ...counts,
        conflictingDuplicates: 1,
        duplicateRatio: 1,
        duplicateTradingDays: 1,
        maxMultiplicity: 2,
        provider: 'iol',
        recordsFetched: withInvalid ? 3 : 2,
        requestCount: 1,
        symbol: 'ALUA',
        market: 'bCBA',
        range: '5Y',
        variant: 'ajustada',
      })
    )
    expect(info).toHaveBeenCalled()
    const { observabilityTestExports } = await import('@/lib/server/core/observability')
    const counters = observabilityTestExports.getObservabilitySnapshot().counters
    expect(counters).toContainEqual(expect.objectContaining({
      name: 'history.duplicate_points.total',
      value: 1,
      tags: expect.objectContaining({
        market: 'bCBA', provider: 'iol', range: '5Y', variant: 'ajustada',
      }),
    }))
    expect(counters).toContainEqual(expect.objectContaining({
      name: 'history.conflicting_duplicate_points.total', value: 1,
    }))
    expect(counters).toContainEqual(expect.objectContaining({
      name: 'history.normalization_anomaly.total', value: 1,
    }))
    if (withInvalid) expect(counters).toContainEqual(expect.objectContaining({ name: 'history.invalid_points.total', value: 1 }))
    else expect(counters.some(counter => counter.name === 'history.invalid_points.total')).toBe(false)
    vi.setSystemTime(new Date('2026-05-07T15:05:01Z'))
    expect(await getOrCreateHistoryResponse('ALUA', 'bCBA', '5Y')).toMatchObject({ cacheStatus: 'stale', meta: { ...counts, stale: true }, data: fresh.data })
    expect(iolFetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['1W', '2026-04-16'], ['1M', '2026-03-24'],
    ['3M', '2026-01-24'], ['6M', '2025-10-24'],
    ['1Y', '2025-04-23'], ['3Y', '2023-04-23'], ['5Y', '2021-04-23'],
  ] as const)('requests the expected date period for %s', async (range, start) => {
    const iolFetch = vi.fn().mockResolvedValue([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)
    const response = await getOrCreateHistoryResponse('ALUA', 'bCBA', range)

    expect(iolFetch).toHaveBeenCalledExactlyOnceWith(
      `/api/v2/bCBA/Titulos/ALUA/Cotizacion/seriehistorica/${start}/2026-05-07/ajustada`
    )
    expect(response).toMatchObject({ ok: true, range, meta: { source: 'live' } })
  })

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
      .mockRejectedValueOnce(new IolUpstreamNetworkError('upstream offline'))
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
    expect(stale.meta).toMatchObject({ resolvedVariant: 'ajustada' })
    expect(stale.data).toEqual([{ date: '2026-05-07', close: 101 }])
    expect(iolFetch).toHaveBeenCalledTimes(2)
    expect(iolFetch.mock.calls[1]?.[0]).toContain('/ajustada')
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
    expect(stale.meta).toMatchObject({ resolvedVariant: 'ajustada' })
  })

  it('preserves an unadjusted variant through fresh cache hits', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    const fresh = await getOrCreateHistoryResponse('AAPL', 'bCBA', '1W')
    const cached = await getOrCreateHistoryResponse('AAPL', 'bCBA', '1W')

    expect(fresh.meta).toMatchObject({ resolvedVariant: 'sinAjustar' })
    expect(cached).toMatchObject({
      cacheStatus: 'memory-cache',
      meta: { resolvedVariant: 'sinAjustar', stale: false },
    })
    expect(iolFetch).toHaveBeenCalledTimes(2)
    expect(info).toHaveBeenCalledWith(
      '[stock-history]',
      expect.objectContaining({
        args: [
          'selected-variant',
          expect.objectContaining({
            provider: 'iol',
            recordsFetched: 1,
            requestCount: 2,
            servedTradingDays: 1,
          }),
        ],
      })
    )
  })

  it('preserves an unadjusted variant through stale fallback', async () => {
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fecha: '2026-05-07', ultimoPrecio: 101 }])
      .mockRejectedValueOnce(new IolUpstreamTimeoutError('timed out'))
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    await getOrCreateHistoryResponse('AAPL', 'bCBA', '1W')
    vi.setSystemTime(new Date('2026-05-07T15:05:01.000Z'))

    const stale = await getOrCreateHistoryResponse('AAPL', 'bCBA', '1W')

    expect(stale).toMatchObject({
      cacheStatus: 'stale',
      meta: { resolvedVariant: 'sinAjustar', stale: true },
    })
    expect(iolFetch).toHaveBeenCalledTimes(3)
    expect(iolFetch.mock.calls[2]?.[0]).toContain('/ajustada')
  })

  it('propagates an unadjusted fallback failure without caching it', async () => {
    const fallbackError = upstreamHttpError(500)
    const iolFetch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(fallbackError)
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    await expect(
      getOrCreateHistoryResponse('AAPL', 'bCBA', '1W')
    ).rejects.toBe(fallbackError)
    expect(iolFetch).toHaveBeenCalledTimes(2)

    iolFetch.mockResolvedValueOnce([
      { fecha: '2026-05-07', ultimoPrecio: 102 },
    ])
    await expect(
      getOrCreateHistoryResponse('AAPL', 'bCBA', '1W')
    ).resolves.toMatchObject({ meta: { resolvedVariant: 'ajustada' } })
    expect(iolFetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['404', upstreamHttpError(404)],
    ['400', upstreamHttpError(400)],
    ['422', upstreamHttpError(422)],
    ['401', upstreamHttpError(401)],
    ['403', upstreamHttpError(403)],
    ['429', upstreamHttpError(429)],
    ['500', upstreamHttpError(500)],
    ['timeout', new IolUpstreamTimeoutError('timed out')],
    ['network', new IolUpstreamNetworkError('offline')],
    ['malformed JSON', new IolUpstreamResponseError('invalid JSON')],
  ])('does not try unadjusted after an adjusted %s error', async (_label, error) => {
    const iolFetch = vi.fn().mockRejectedValue(error)
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    await expect(
      getOrCreateHistoryResponse('GGAL', 'bCBA', '1W')
    ).rejects.toBe(error)
    expect(iolFetch).toHaveBeenCalledTimes(1)
    expect(iolFetch.mock.calls[0]?.[0]).toContain('/ajustada')
  })

  it('does not try unadjusted after adjusted normalization fails', async () => {
    const iolFetch = vi.fn().mockResolvedValue([
      { fecha: 'invalid', ultimoPrecio: 101 },
    ])
    const { getOrCreateHistoryResponse } = await loadHistoryService(iolFetch)

    await expect(
      getOrCreateHistoryResponse('GGAL', 'bCBA', '1W')
    ).rejects.toMatchObject({ name: 'StockHistoryNormalizationError' })
    expect(iolFetch).toHaveBeenCalledTimes(1)
    expect(iolFetch.mock.calls[0]?.[0]).toContain('/ajustada')
  })
})
