import { describe, expect, it } from 'vitest'
import { getDemoHistoryData, getDemoPanelData } from './demoMarketData'

describe('demoMarketData history clock', () => {
  it.each([['3Y', 1095], ['5Y', 1825]] as const)(
    'generates deterministic positive business-day data spanning %s', (range, days) => {
      const now = new Date('2026-05-07T18:00:00Z')
      for (const panel of ['lider', 'general', 'cedears'] as const) {
        for (const { simbolo } of getDemoPanelData(panel)) {
          const points = getDemoHistoryData(simbolo, 'bCBA', range, now)
          expect(points).toEqual(getDemoHistoryData(simbolo, 'bCBA', range, now))
          const span = (Date.parse(points.at(-1)!.date) - Date.parse(points[0].date)) / 86400000
          expect(span).toBeGreaterThanOrEqual(days - 2)
          expect(span).toBeLessThanOrEqual(days + 3)
          expect(points.length).toBeGreaterThan(days * 0.7)
          expect(points.length).toBeLessThan(days * 0.72)
          expect(points.every((point, index) =>
            point.close > 0 && point.open! > 0 && point.low! > 0 &&
            point.high! >= point.close && point.low! <= point.close &&
            ![0, 6].includes(new Date(point.date).getUTCDay()) &&
            (index === 0 || point.date > points[index - 1].date)
          )).toBe(true)
        }
      }
    }
  )

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

    expect(points).toHaveLength(6)
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
