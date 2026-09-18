type ResolvePreviousCloseOptions = {
  currentPrice: number | null | undefined
  variation: number | null | undefined
  explicitPreviousClose: number | null | undefined
  historicalPreviousClose?: number | null
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positiveNumber(value: number | null | undefined): number | null {
  const numberValue = finiteNumber(value)

  return numberValue !== null && numberValue > 0 ? numberValue : null
}

function pricesAreEquivalent(first: number, second: number): boolean {
  return Math.abs(first - second) <= Math.max(0.005, Math.abs(first) * 1e-8)
}

export function resolvePreviousClose({
  currentPrice,
  variation,
  explicitPreviousClose,
  historicalPreviousClose,
}: ResolvePreviousCloseOptions): number | null {
  const price = positiveNumber(currentPrice)
  const variationValue = finiteNumber(variation)
  const explicitClose = positiveNumber(explicitPreviousClose)
  const explicitIsSuspicious =
    price !== null &&
    variationValue !== null &&
    variationValue !== 0 &&
    explicitClose !== null &&
    pricesAreEquivalent(explicitClose, price)

  if (explicitClose !== null && !explicitIsSuspicious) {
    return explicitClose
  }

  if (price !== null && variationValue !== null) {
    const derivedClose = deriveStartPriceFromReturnPercentage(
      price,
      variationValue
    )

    if (derivedClose !== null) {
      return derivedClose
    }
  }

  return positiveNumber(historicalPreviousClose)
}
import { deriveStartPriceFromReturnPercentage } from '@/lib/marketPerformance'
