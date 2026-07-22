import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchStockHistory,
  getStockHistoryFetchError,
} from './stockHistoryClient'

function jsonResponse(body: unknown, status = 502): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('getStockHistoryFetchError', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('maps backend history errors to a user-facing message', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const error = await getStockHistoryFetchError(
      jsonResponse({
        ok: false,
        error: 'HISTORY_ERROR',
        details: 'sensitive upstream detail',
      })
    )

    expect(error.message).toBe('No se pudo cargar el histórico.')
  })

  it('includes backend details in development when available', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const error = await getStockHistoryFetchError(
      jsonResponse({
        ok: false,
        error: 'HISTORY_ERROR',
        details: 'upstream failed',
      })
    )

    expect(error.message).toBe(
      'No se pudo cargar el histórico. Detalle: upstream failed'
    )
  })
})

describe('fetchStockHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes the request URL when the history response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 200 }))
    )

    await expect(
      fetchStockHistory('/api/stocks/GGAL/history?range=1M&market=bCBA')
    ).rejects.toThrow(
      'Respuesta inválida del servidor al cargar el histórico: /api/stocks/GGAL/history?range=1M&market=bCBA'
    )
  })

  it('rejects an impossible calendar date from the server contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          data: [{ date: '2026-02-30', close: 100 }],
          fetchedAt: '2026-03-01T00:00:00.000Z',
          servedAt: '2026-03-01T00:00:00.000Z',
          cacheStatus: 'fresh',
          range: '1M',
          market: 'bCBA',
          symbol: 'GGAL',
          meta: {
            discardedPoints: 0,
            source: 'live',
            stale: false,
            totalPoints: 1,
          },
        })
      )
    )

    await expect(
      fetchStockHistory('/api/stocks/GGAL/history?range=1M&market=bCBA')
    ).rejects.toThrow('Respuesta inválida del servidor: históricos inválidos.')
  })

  it.each([
    [
      'duplicate',
      [
        { date: '2026-05-07', close: 100 },
        { date: '2026-05-07', close: 101 },
      ],
    ],
    [
      'descending',
      [
        { date: '2026-05-08', close: 101 },
        { date: '2026-05-07', close: 100 },
      ],
    ],
  ])('rejects %s dates from the BFF contract', async (_label, data) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          data,
          fetchedAt: '2026-05-08T15:00:00.000Z',
          servedAt: '2026-05-08T15:00:00.000Z',
          cacheStatus: 'fresh',
          range: '1M',
          market: 'bCBA',
          symbol: 'GGAL',
          meta: {
            discardedPoints: 0,
            source: 'live',
            stale: false,
            totalPoints: data.length,
          },
        })
      )
    )

    await expect(
      fetchStockHistory('/api/stocks/GGAL/history?range=1M&market=bCBA')
    ).rejects.toThrow('fechas únicas y ascendentes')
  })

  it('accepts an explicit stale history response', async () => {
    const staleResponse = {
      ok: true,
      data: [{ date: '2026-05-07', close: 100 }],
      fetchedAt: '2026-05-07T15:00:00.000Z',
      servedAt: '2026-05-07T15:06:00.000Z',
      cacheStatus: 'stale',
      range: '1M',
      market: 'bCBA',
      symbol: 'GGAL',
      meta: {
        discardedPoints: 0,
        source: 'live',
        stale: true,
        totalPoints: 1,
      },
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(staleResponse)))

    await expect(
      fetchStockHistory('/api/stocks/GGAL/history?range=1M&market=bCBA')
    ).resolves.toEqual(staleResponse)
  })

  it.each([
    ['unknown status', 'expired', true],
    ['fresh marked stale', 'fresh', true],
    ['memory cache marked stale', 'memory-cache', true],
    ['stale status marked fresh', 'stale', false],
  ])('rejects %s', async (_label, cacheStatus, stale) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          data: [{ date: '2026-05-07', close: 100 }],
          fetchedAt: '2026-05-07T15:00:00.000Z',
          servedAt: '2026-05-07T15:06:00.000Z',
          cacheStatus,
          range: '1M',
          market: 'bCBA',
          symbol: 'GGAL',
          meta: {
            discardedPoints: 0,
            source: 'live',
            stale,
            totalPoints: 1,
          },
        })
      )
    )

    await expect(
      fetchStockHistory('/api/stocks/GGAL/history?range=1M&market=bCBA')
    ).rejects.toThrow('estado de caché histórica inválido')
  })
})
