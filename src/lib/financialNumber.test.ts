import { describe, expect, it } from 'vitest'
import { parseFinancialNumber } from './financialNumber'

describe('financial number policies', () => {
  it.each([
    ['0.123', 0.123], ['1.234', 1.234], ['0,123', 0.123],
    ['-1.234', -1.234], ['-0,123', -0.123], ['+1.234', 1.234],
    ['1.234,56', 1234.56], ['1,234.56', 1234.56],
    ['-1.234,56', -1234.56], ['-1,234.56', -1234.56],
    ['1.234.567', 1234567], ['1,234,567', 1234567],
    ['0', 0], ['0.000', 0], ['0,00', 0], [0, 0], [1.234, 1.234],
    [' 12,50 ', 12.5], ['1234', 1234],
  ])('parses decimal %s as %s', (input, expected) => {
    expect(parseFinancialNumber(input, 'decimal')).toBe(expected)
  })

  it.each([
    ['1.234', 1234], ['1,234', 1234], ['-1.234', -1234],
    ['+1,234', 1234], ['0.123', 0.123], ['0.000', 0],
    ['1.234,56', 1234.56], ['1,234.56', 1234.56], [1.234, 1.234],
  ])('parses grouped quantities %s as %s', (input, expected) => {
    expect(parseFinancialNumber(input, 'grouped')).toBe(expected)
  })

  it.each(['', ' ', 'abc123', '$ 123.45', '1e3', '0x10', '12.34.56',
    '1,23,456', '1.234,5.6', '--1', '.', '-', 'Infinity', null, undefined,
    true, [], {}, NaN, Infinity, '9'.repeat(400),
  ])('rejects invalid input %s under both policies', (input) => {
    expect(parseFinancialNumber(input, 'decimal')).toBeNull()
    expect(parseFinancialNumber(input, 'grouped')).toBeNull()
  })
})
