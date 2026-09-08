import { describe, expect, it } from 'vitest'
import { assertMarketPanelSuccessResponse } from './marketPanelClient'

function panelResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: [{ simbolo: 'GGAL', descripcion: 'Galicia' }],
    fetchedAt: '2026-07-15T15:00:00.000Z',
    servedAt: '2026-07-15T15:00:30.000Z',
    staleUntil: '2026-07-15T15:02:00.000Z',
    cacheStatus: 'memory-cache',
    stale: false,
    ...overrides,
  }
}

describe('market panel freshness validation', () => {
  it('accepts a coherent memory-cache contract', () => {
    expect(() => assertMarketPanelSuccessResponse(panelResponse())).not.toThrow()
  })

  it.each([
    { degradationReason: 'upstream-unavailable' },
    { servedAt: '2026-07-15T14:59:59.999Z' },
    { staleUntil: 'invalid' },
    { stale: true },
  ])('rejects contradictory panel metadata %#', (overrides) => {
    expect(() => assertMarketPanelSuccessResponse(panelResponse(overrides))).toThrow(
      'metadata inválida'
    )
  })

  it('accepts stale only with its degradation metadata inside the window', () => {
    expect(() =>
      assertMarketPanelSuccessResponse(
        panelResponse({
          cacheStatus: 'stale',
          stale: true,
          degradationReason: 'upstream-unavailable',
        })
      )
    ).not.toThrow()
  })
})
