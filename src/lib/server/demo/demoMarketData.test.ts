import { describe, expect, it } from 'vitest'
import { getDemoHistoryData } from './demoMarketData'

describe('demoMarketData history clock', () => {
  function withoutTemporalFields(points: ReturnType<typeof getDemoHistoryData>) {
    return points.map((point) =>
      Object.fromEntries(
        Object.entries(point).filter(
          ([field]) => field !== 'date' && field !== 'timestamp'
        )
      )
    )
  }

  it('keeps a one-week range relative to an injected current date', () => {
    const points = getDemoHistoryData(
      'GGAL',
      'bCBA',
      '1W',
      new Date('2026-08-11T18:00:00.000Z')
    )

    expect(points).toHaveLength(7)
    expect(points.at(-1)?.date).toBe('2026-08-11')
    expect(points.every((point) => point.date.startsWith('2026-08'))).toBe(true)
    expect(
      Date.parse(points.at(-1)!.date) - Date.parse(points[0].date)
    ).toBeLessThanOrEqual(10 * 24 * 60 * 60 * 1_000)
  })

  it('keeps prices deterministic when only the clock changes', () => {
    const may = getDemoHistoryData(
      'GGAL',
      'bCBA',
      '1W',
      new Date('2026-05-26T18:00:00.000Z')
    )
    const august = getDemoHistoryData(
      'GGAL',
      'bCBA',
      '1W',
      new Date('2026-08-11T18:00:00.000Z')
    )

    expect(withoutTemporalFields(august)).toEqual(withoutTemporalFields(may))
  })

  it('uses the Argentina calendar date near the UTC day boundary', () => {
    const points = getDemoHistoryData(
      'GGAL',
      'bCBA',
      '1W',
      new Date('2026-08-12T01:30:00.000Z')
    )

    expect(points.at(-1)?.date).toBe('2026-08-11')
  })
})
