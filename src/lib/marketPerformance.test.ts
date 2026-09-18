import { describe, expect, it } from 'vitest'
import {
  applySplitCorporateActions,
  calculateDailyVariationPercentage,
  calculateReturnPercentage,
  deriveStartPriceFromReturnPercentage,
  findSuspiciousPriceDiscontinuity,
  getPerformanceTargetDate,
  selectPerformanceWindow,
  toMarketCalendarDate,
} from './marketPerformance'
import { formatPercentage } from './formatters'

describe('market performance', () => {
  it.each([
    [100, 110, 10],
    [100, 90, -10],
    [100, 100, 0],
  ])('calculates a full-precision close-to-close return (%s -> %s)', (start, end, expected) => {
    expect(calculateReturnPercentage(start, end)).toBeCloseTo(expected, 12)
    expect(calculateDailyVariationPercentage(start, end)).toBeCloseTo(
      expected,
      12
    )
  })

  it.each([
    [0, 100],
    [-1, 100],
    [100, -1],
    [null, 100],
    [100, null],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ])('rejects invalid prices (%s, %s)', (start, end) => {
    expect(calculateReturnPercentage(start, end)).toBeNull()
  })

  it('derives the unrounded previous close from a quoted percentage', () => {
    const previousClose = deriveStartPriceFromReturnPercentage(95.67, -4.33)

    expect(previousClose).not.toBeNull()
    expect(calculateReturnPercentage(previousClose, 95.67)).toBeCloseTo(-4.33, 12)
    expect(deriveStartPriceFromReturnPercentage(100, -100)).toBeNull()
  })

  it('covers the PAMP regression through the production formula', () => {
    const result = selectPerformanceWindow(
      [
        { date: '2025-09-17', close: 3595 },
        { date: '2025-09-18', close: 3520 },
        { date: '2026-09-17', close: 5335 },
      ],
      '1Y'
    )

    expect(result.start).toEqual({ date: '2025-09-17', close: 3595 })
    expect(result.end).toEqual({ date: '2026-09-17', close: 5335 })
    expect(result.returnPercentage).toBeCloseTo(48.40055632823365, 12)
    expect(result.returnPercentage).not.toBeCloseTo(51.56, 2)
    expect(formatPercentage(result.returnPercentage)).toBe('+48,40%')
  })

  it.each([
    ['1M', '2026-08-17'],
    ['3M', '2026-06-17'],
    ['6M', '2026-03-17'],
    ['1Y', '2025-09-17'],
    ['3Y', '2023-09-17'],
    ['5Y', '2021-09-17'],
    ['YTD', '2026-01-01'],
  ] as const)('uses calendar semantics for %s', (period, target) => {
    expect(getPerformanceTargetDate('2026-09-17', period)).toBe(target)
  })

  it('clamps leap-day yearly targets deterministically', () => {
    expect(getPerformanceTargetDate('2024-02-29', '1Y')).toBe('2023-02-28')
    expect(getPerformanceTargetDate('2024-02-29', '5Y')).toBe('2019-02-28')
  })

  it('uses the Argentina market date near the UTC boundary', () => {
    expect(toMarketCalendarDate(new Date('2026-08-12T01:30:00.000Z'))).toBe(
      '2026-08-11'
    )
  })

  it.each([
    ['Saturday', '2026-05-02'],
    ['Sunday', '2026-05-03'],
    ['holiday', '2026-05-01'],
    ['missing exact observation', '2026-05-04'],
  ])('selects the last trading close on or before a %s target', (_label, targetDate) => {
    const endDate = getPerformanceTargetDate(targetDate, '1Y')
    expect(endDate).not.toBeNull()
    const result = selectPerformanceWindow(
      [
        { date: '2025-04-30', close: 100 },
        { date: '2025-05-05', close: 101 },
        { date: targetDate, close: 110 },
      ],
      '1Y'
    )

    expect(result.targetDate).toBe(endDate)
    expect(result.start?.date).toBe('2025-04-30')
  })

  it('sorts and deduplicates by calendar date before selecting endpoints', () => {
    const result = selectPerformanceWindow(
      [
        { date: '2026-05-07', close: 110 },
        { date: '2025-05-07', close: 95 },
        { date: '2025-05-07T20:00:00Z', close: 100 },
        { date: 'invalid', close: 999 },
      ],
      '1Y'
    )

    expect(result.points).toEqual([
      { date: '2025-05-07', close: 100 },
      { date: '2026-05-07', close: 110 },
    ])
    expect(result.returnPercentage).toBeCloseTo(10, 12)
  })

  it('reports empty, single-point and insufficient periods without inventing a return', () => {
    expect(selectPerformanceWindow([], '1Y')).toMatchObject({
      status: 'empty',
      returnPercentage: null,
    })
    expect(
      selectPerformanceWindow([{ date: '2026-05-07', close: 100 }], '1Y')
    ).toMatchObject({ status: 'insufficient', returnPercentage: null })
    expect(
      selectPerformanceWindow(
        [
          { date: '2026-05-06', close: 99 },
          { date: '2026-05-07', close: 100 },
        ],
        '1Y'
      )
    ).toMatchObject({ status: 'missing-reference', returnPercentage: null })
  })

  it.each([
    ['2:1 split', 2, 100, 50],
    ['3:1 split', 3, 300, 100],
    ['1:10 reverse split', 0.1, 10, 100],
  ])('keeps economic continuity across a %s', (_label, ratio, before, after) => {
    const adjusted = applySplitCorporateActions(
      [
        { date: '2026-01-01', close: before },
        { date: '2026-01-02', close: after },
      ],
      [{ effectiveDate: '2026-01-02', ratio }],
      'raw'
    )

    expect(calculateReturnPercentage(adjusted[0].close, adjusted[1].close)).toBe(0)
  })

  it('applies multiple split factors exactly once', () => {
    const adjusted = applySplitCorporateActions(
      [
        { date: '2026-01-01', close: 600 },
        { date: '2026-02-01', close: 300 },
        { date: '2026-03-01', close: 100 },
      ],
      [
        { effectiveDate: '2026-02-01', ratio: 2 },
        { effectiveDate: '2026-03-01', ratio: 3 },
      ],
      'raw'
    )

    expect(adjusted.map((point) => point.close)).toEqual([100, 100, 100])
  })

  it('does not adjust a period that does not cross the split', () => {
    const adjusted = applySplitCorporateActions(
      [
        { date: '2026-02-01', close: 50 },
        { date: '2026-02-02', close: 55 },
      ],
      [{ effectiveDate: '2026-01-15', ratio: 2 }],
      'raw'
    )

    expect(adjusted.map((point) => point.close)).toEqual([50, 55])
    expect(calculateReturnPercentage(adjusted[0].close, adjusted[1].close)).toBeCloseTo(10, 12)
  })

  it('never applies corporate actions again to provider-adjusted closes', () => {
    const providerAdjusted = [
      { date: '2026-01-01', close: 50 },
      { date: '2026-01-02', close: 50 },
    ]
    const result = applySplitCorporateActions(
      providerAdjusted,
      [{ effectiveDate: '2026-01-02', ratio: 2 }],
      'provider-adjusted'
    )

    expect(result).toEqual(providerAdjusted)
    expect(calculateReturnPercentage(result[0].close, result[1].close)).toBe(0)
  })

  it('fails closed when provider-adjusted data still contains a split-like jump', () => {
    expect(
      findSuspiciousPriceDiscontinuity([
        { date: '2026-07-31', close: 83000 },
        { date: '2026-08-03', close: 8105 },
      ])
    ).toMatchObject({
      previousDate: '2026-07-31',
      currentDate: '2026-08-03',
    })
    expect(
      findSuspiciousPriceDiscontinuity([
        { date: '2026-07-31', close: 100 },
        { date: '2026-08-03', close: 120 },
      ])
    ).toBeNull()
  })
})
