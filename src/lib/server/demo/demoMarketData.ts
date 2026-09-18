import 'server-only'

import type { MarketDataPanelKey } from '@/lib/market'
import type { PanelTitulo } from '@/lib/panel'
import {
  type StockHistoryMarket,
  type StockHistoryPoint,
  type StockHistoryRange,
} from '@/lib/stockHistory'
import type { StockQuoteDetail } from '@/lib/stockQuote'
import {
  calculateDailyVariationPercentage,
  getPerformanceTargetDate,
  selectPerformanceWindow,
  shiftCalendarDate,
} from '@/lib/marketPerformance'

type DemoSymbolProfile = {
  close: number
  dailyDrift: number
  description: string
  openBias: number
  trendAmplitude: number
  volumeBase: number
}

const DEMO_PANEL_DATA: Record<MarketDataPanelKey, PanelTitulo[]> = {
  lider: [
    createPanelRow('GGAL', 'Grupo Financiero Galicia', 9520, 2.84, 2400, 9480, 9548, 1800, 9362, 9630, 9298, 9374, 3_480_120),
    createPanelRow('YPFD', 'YPF', 31420, -1.62, 620, 31380, 31495, 540, 31850, 32110, 31220, 31936, 1_205_870),
    createPanelRow('PAMP', 'Pampa Energía', 4275, 0.94, 980, 4260, 4282, 760, 4230, 4310, 4202, 4235, 2_031_450),
    createPanelRow('TXAR', 'Ternium Argentina', 1488, 4.21, 1400, 1480, 1492, 1200, 1425, 1498, 1412, 1428, 4_198_220),
    createPanelRow('ALUA', 'Aluar', 875, -0.58, 3100, 872, 876, 2700, 880, 886, 870, 880, 5_512_900),
    createPanelRow('CEPU', 'Central Puerto', 1930, 1.37, 850, 1924, 1936, 760, 1902, 1941, 1890, 1904, 1_743_600),
  ],
  general: [
    createPanelRow('BMA', 'Banco Macro', 11420, 2.13, 520, 11390, 11450, 420, 11170, 11490, 11120, 11182, 683_420),
    createPanelRow('COME', 'Sociedad Comercial del Plata', 182, -1.15, 9200, 181.5, 182.5, 8400, 184.1, 185.8, 180.8, 184.1, 12_408_600),
    createPanelRow('CRES', 'Cresud', 1320, 0.76, 2500, 1318, 1322, 2300, 1304, 1338, 1298, 1310, 2_886_310),
    createPanelRow('LOMA', 'Loma Negra', 2480, -2.08, 610, 2474, 2488, 540, 2528, 2540, 2468, 2532, 944_870),
    createPanelRow('SUPV', 'Grupo Supervielle', 1645, 3.42, 730, 1640, 1652, 680, 1588, 1659, 1576, 1591, 1_102_540),
    createPanelRow('TGSU2', 'Transportadora de Gas del Sur', 5210, 0.28, 460, 5200, 5218, 410, 5194, 5245, 5178, 5195, 328_410),
  ],
  cedears: [
    createPanelRow('AAPL', 'Apple', 218750, 1.46, 12, 218500, 218900, 10, 215320, 219840, 214980, 215600, 74_500),
    createPanelRow('MSFT', 'Microsoft', 422180, 0.88, 8, 421900, 422500, 7, 418400, 423700, 417980, 418500, 31_820),
    createPanelRow('GOOGL', 'Alphabet', 173200, -0.74, 18, 173050, 173380, 14, 174480, 175100, 172920, 174490, 59_210),
    createPanelRow('NVDA', 'NVIDIA', 95410, 4.92, 45, 95340, 95520, 40, 90940, 95800, 90520, 90930, 86_740),
    createPanelRow('TSLA', 'Tesla', 248600, -3.15, 14, 248320, 248880, 12, 256700, 257920, 247940, 256690, 68_550),
    createPanelRow('KO', 'Coca-Cola', 68420, 0.19, 20, 68390, 68470, 16, 68290, 68620, 68140, 68290, 42_330),
  ],
}

const DEMO_SYMBOL_PROFILES: Record<string, DemoSymbolProfile> = {
  GGAL: createSymbolProfile('Grupo Financiero Galicia', 9520, 0.0032, 0.0048, 0.018, 3_480_120),
  YPFD: createSymbolProfile('YPF', 31420, -0.0018, 0.0062, 0.021, 1_205_870),
  PAMP: createSymbolProfile('Pampa Energía', 4275, 0.0014, 0.0041, 0.015, 2_031_450),
  TXAR: createSymbolProfile('Ternium Argentina', 1488, 0.0045, 0.007, 0.023, 4_198_220),
  ALUA: createSymbolProfile('Aluar', 875, -0.0009, 0.0038, 0.013, 5_512_900),
  CEPU: createSymbolProfile('Central Puerto', 1930, 0.0018, 0.0045, 0.016, 1_743_600),
  BMA: createSymbolProfile('Banco Macro', 11420, 0.0024, 0.0052, 0.019, 683_420),
  COME: createSymbolProfile('Sociedad Comercial del Plata', 182, -0.0015, 0.0078, 0.027, 12_408_600),
  CRES: createSymbolProfile('Cresud', 1320, 0.0012, 0.0048, 0.017, 2_886_310),
  LOMA: createSymbolProfile('Loma Negra', 2480, -0.0023, 0.0056, 0.02, 944_870),
  SUPV: createSymbolProfile('Grupo Supervielle', 1645, 0.0036, 0.0068, 0.024, 1_102_540),
  TGSU2: createSymbolProfile('Transportadora de Gas del Sur', 5210, 0.0005, 0.0036, 0.012, 328_410),
  AAPL: createSymbolProfile('Apple', 218750, 0.0011, 0.0034, 0.011, 74_500),
  MSFT: createSymbolProfile('Microsoft', 422180, 0.0009, 0.0028, 0.009, 31_820),
  GOOGL: createSymbolProfile('Alphabet', 173200, -0.0007, 0.0039, 0.012, 59_210),
  NVDA: createSymbolProfile('NVIDIA', 95410, 0.0048, 0.0085, 0.028, 86_740),
  TSLA: createSymbolProfile('Tesla', 248600, -0.0031, 0.0092, 0.031, 68_550),
  KO: createSymbolProfile('Coca-Cola', 68420, 0.0002, 0.0021, 0.007, 42_330),
}

const HISTORY_REFERENCE_BUFFER_DAYS = 14

const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'

function getArgentinaCalendarDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARGENTINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)

  return new Date(Date.UTC(year, month - 1, day))
}

function createPanelRow(
  simbolo: string,
  descripcion: string,
  ultimoPrecio: number,
  _variacionPorcentual: number,
  cantidadCompra: number,
  precioCompra: number,
  precioVenta: number,
  cantidadVenta: number,
  apertura: number,
  maximo: number,
  minimo: number,
  ultimoCierre: number,
  volumen: number
): PanelTitulo {
  return {
    simbolo,
    descripcion,
    ultimoPrecio,
    variacionPorcentual:
      calculateDailyVariationPercentage(ultimoCierre, ultimoPrecio) ?? 0,
    puntas: {
      cantidadCompra,
      precioCompra,
      precioVenta,
      cantidadVenta,
    },
    apertura,
    maximo,
    minimo,
    ultimoCierre,
    volumen,
  }
}

function createSymbolProfile(
  description: string,
  close: number,
  dailyDrift: number,
  openBias: number,
  trendAmplitude: number,
  volumeBase: number
): DemoSymbolProfile {
  return {
    close,
    dailyDrift,
    description,
    openBias,
    trendAmplitude,
    volumeBase,
  }
}

function clonePanelRows(rows: readonly PanelTitulo[]): PanelTitulo[] {
  return rows.map((row) => ({
    ...row,
    puntas: row.puntas ? { ...row.puntas } : undefined,
  }))
}

function createSeed(symbol: string): number {
  return [...symbol].reduce(
    (seed, char, index) => seed + char.charCodeAt(0) * (index + 11),
    97
  )
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2))
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getBusinessDates(range: StockHistoryRange, now: Date): Date[] {
  const cursor = getArgentinaCalendarDate(now)
  const endDate = toIsoDate(cursor)
  const targetDate = getPerformanceTargetDate(endDate, range)
  const bufferedStartDate = targetDate
    ? shiftCalendarDate(targetDate, -HISTORY_REFERENCE_BUFFER_DAYS)
    : null

  if (!bufferedStartDate) {
    return []
  }

  const start = new Date(`${bufferedStartDate}T00:00:00.000Z`)
  const dates: Date[] = []

  while (cursor >= start) {
    const day = cursor.getUTCDay()

    if (day !== 0 && day !== 6) {
      dates.push(new Date(cursor))
    }

    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }

  return dates.reverse()
}

export function getDemoPanelData(type: MarketDataPanelKey): PanelTitulo[] {
  return clonePanelRows(DEMO_PANEL_DATA[type])
}

export function getDemoQuoteBySymbol(symbol: string): PanelTitulo | null {
  const normalizedSymbol = symbol.toUpperCase()

  for (const panel of Object.values(DEMO_PANEL_DATA)) {
    const match = panel.find((row) => row.simbolo === normalizedSymbol)

    if (match) {
      return {
        ...match,
        puntas: match.puntas ? { ...match.puntas } : undefined,
      }
    }
  }

  return null
}

export function getDemoQuoteDetailBySymbol(
  symbol: string,
  market: StockHistoryMarket
): StockQuoteDetail | null {
  const quote = getDemoQuoteBySymbol(symbol)

  if (!quote || typeof quote.ultimoPrecio !== 'number') {
    return null
  }

  const depth = quote.puntas
    ? [
        {
          buyQuantity: quote.puntas.cantidadCompra ?? null,
          buyPrice: quote.puntas.precioCompra ?? null,
          sellPrice: quote.puntas.precioVenta ?? null,
          sellQuantity: quote.puntas.cantidadVenta ?? null,
        },
      ]
    : []

  return {
    symbol: quote.simbolo,
    market,
    description: quote.descripcion,
    price: quote.ultimoPrecio,
    variation: quote.variacionPorcentual ?? null,
    open: quote.apertura ?? null,
    high: quote.maximo ?? null,
    low: quote.minimo ?? null,
    timestamp: new Date().toISOString(),
    previousClose: quote.ultimoCierre ?? null,
    amountTraded: null,
    volume: quote.volumen ?? null,
    averagePrice: null,
    currency: 'peso_Argentino',
    openInterest: null,
    operationCount: null,
    settlement: null,
    minimumSheet: null,
    lot: null,
    minimumQuantity: null,
    depth,
  }
}

export function getDemoHistoryData(
  symbol: string,
  _market: StockHistoryMarket,
  range: StockHistoryRange,
  now = new Date()
): StockHistoryPoint[] {
  const normalizedSymbol = symbol.toUpperCase()
  const profile = DEMO_SYMBOL_PROFILES[normalizedSymbol]

  if (!profile) {
    return []
  }

  const dates = getBusinessDates(range, now)
  const seed = createSeed(normalizedSymbol)
  const points: StockHistoryPoint[] = []

  for (const [index, date] of dates.entries()) {
    const progress = index / Math.max(1, dates.length - 1)
    const wave =
      Math.sin((index + seed) / 3.2) * profile.trendAmplitude +
      Math.cos((index + seed) / 7.5) * (profile.trendAmplitude / 2)
    const driftFactor = range === '3Y' || range === '5Y'
      ? (1 + profile.dailyDrift) ** index
      : 1 + profile.dailyDrift * index
    const close = roundPrice(profile.close * driftFactor * (1 + wave))
    const previousClose = points[index - 1]?.close ?? roundPrice(close * 0.992)
    const open = roundPrice(previousClose * (1 + Math.sin(seed + index) * profile.openBias))
    const high = roundPrice(Math.max(open, close) * (1.006 + ((seed + index) % 5) * 0.0018))
    const low = roundPrice(Math.min(open, close) * (0.994 - ((seed + index) % 4) * 0.0013))
    const volume = Math.max(
      1,
      Math.round(
        profile.volumeBase *
          (0.68 + progress * 0.42 + Math.abs(Math.cos((index + seed) / 4.1)) * 0.33)
      )
    )
    const dailyVariation =
      calculateDailyVariationPercentage(previousClose, close) ?? 0
    const averagePrice = roundPrice((open + high + low + close) / 4)

    points.push({
      date: toIsoDate(date),
      timestamp: `${toIsoDate(date)}T20:00:00.000Z`,
      open,
      high,
      low,
      close,
      volume,
      dailyVariation,
      previousClose,
      amountTraded: roundPrice(averagePrice * volume),
      averagePrice,
      currency: 'peso_Argentino',
      operationCount: Math.max(1, Math.round(volume / 850)),
      description: profile.description,
      settlement: '48hs',
      minimumSheet: 1,
      lot: 1,
      bid: {
        buyQuantity: Math.max(1, Math.round(volume * 0.0012)),
        buyPrice: roundPrice(close * 0.998),
        sellPrice: roundPrice(close * 1.002),
        sellQuantity: Math.max(1, Math.round(volume * 0.001)),
      },
    })
  }

  const selectedWindow = selectPerformanceWindow(points, range)

  return selectedWindow.start ? selectedWindow.points : points
}

