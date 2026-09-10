export type FinancialNumberPolicy = 'decimal' | 'grouped'

/** A single separator means decimals unless the field explicitly admits grouping.
 * Mixed separators and repeated groups are unambiguous in either policy.
 * Reject malformed input instead of stripping arbitrary characters.
 */
export function parseFinancialNumber(
  value: unknown,
  policy: FinancialNumberPolicy = 'decimal'
): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const input = value.trim()
  let normalized: string
  const singleDecimal = /^[+-]?\d+[.,]\d+$/.test(input)
  const singleGroup = /^[+-]?[1-9]\d{0,2}[.,]\d{3}$/.test(input)

  if (singleDecimal && !(policy === 'grouped' && singleGroup)) {
    normalized = input.replace(',', '.')
  } else if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(input)) {
    normalized = input.replace(/,/g, '')
  } else if (/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(input)) {
    normalized = input.replace(/\./g, '').replace(',', '.')
  } else if (/^[+-]?\d+$/.test(input)) {
    normalized = input
  } else {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
