// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type StockData } from '@/features/dashboard/shared/stockData'
import { type StockQuoteDetail } from '@/lib/stockQuote'
import { type StockHistoryRange } from '@/lib/stockHistory'
import StockDetailsContent from './StockDetailsContent'

const chartMocks = vi.hoisted(() => ({
  advancedPoints: vi.fn(),
  simplePoints: vi.fn(),
}))

vi.mock('@/features/dashboard/stock-detail/useStockHistory', () => ({
  useStockHistory: () => ({
    points: [
      {
        date: '2026-05-01',
        open: 98,
        high: 102,
        low: 97,
        close: 100,
        volume: 1000,
      },
      {
        date: '2026-05-02',
        open: 100,
        high: 112,
        low: 99,
        close: 110,
        volume: 3000,
      },
    ],
    meta: {
      invalidPoints: 0,
      duplicatePoints: 0,
      discardedPoints: 0,
      source: 'demo',
      stale: false,
      totalPoints: 2,
    },
    error: undefined,
    isLoading: false,
    isRefreshing: false,
    viewStatus: 'success',
  }),
}))

vi.mock('@/features/dashboard/charts/LightweightStockChart', () => ({
  default: (props: { points: Array<{ date: string; close: number }> }) => {
    chartMocks.simplePoints(props.points)
    return <div data-testid="simple-chart" />
  },
}))

vi.mock('@/features/dashboard/charts/AdvancedStockDetailChart', () => ({
  default: (props: {
    points: Array<{ date: string; close: number }>
    rangeControls?: React.ReactNode
  }) => {
    chartMocks.advancedPoints(props.points)
    return (
      <div data-testid="advanced-chart">
        <label>
          Tipo de gráfico
          <select defaultValue="candles">
            <option value="candles">Velas</option>
          </select>
        </label>
        {props.rangeControls}
      </div>
    )
  },
}))

const stock: StockData = {
  ticker: 'GGAL',
  description: 'Grupo Financiero Galicia',
  price: 110,
  var: 1.5,
  varType: 'positive',
  buyQty: 10,
  buyPrice: 109,
  sellPrice: 111,
  sellQty: 20,
  open: 100,
  min: 99,
  max: 112,
  close: 108,
  volume: 3000,
  quoteDate: '2026-05-03T20:00:00.000Z',
  amountTraded: 330000,
  operationCount: 0,
  currency: 'peso_Argentino',
  settlement: '48hs',
  minimumSheet: 1,
  lot: 1,
}

const pageHistory = {
  points: [
    {
      date: '2026-05-01',
      timestamp: '2026-05-01T20:00:00.000Z',
      open: 98,
      high: 102,
      low: 97,
      close: 100,
      volume: 1000,
    },
    {
      date: '2026-05-02',
      timestamp: '2026-05-02T20:00:00.000Z',
      open: 100,
      high: 112,
      low: 99,
      close: 110,
      volume: 3000,
      dailyVariation: 0,
      previousClose: 0,
      amountTraded: 330000,
      averagePrice: 105.5,
      currency: 'peso_Argentino',
      operationCount: 0,
      settlement: '48hs',
      minimumSheet: 1,
      lot: 1,
      bid: {
        buyQuantity: 10,
        buyPrice: 109,
        sellPrice: 111,
        sellQuantity: 20,
      },
    },
  ],
  meta: {
    invalidPoints: 0,
    duplicatePoints: 0,
    discardedPoints: 0,
    source: 'demo' as const,
    stale: false,
    totalPoints: 2,
  },
  error: undefined,
  isLoading: false,
  isRefreshing: false,
  viewStatus: 'success' as const,
}

const quoteDetail: StockQuoteDetail = {
  symbol: 'GGAL',
  market: 'bcba',
  description: 'Grupo Financiero Galicia S.A',
  price: 7615,
  variation: -4.33,
  open: 7860,
  high: 7950,
  low: 7575,
  timestamp: '2026-06-24T16:59:55.3901383-03:00',
  previousClose: 7960,
  amountTraded: 20190703365,
  volume: 0,
  averagePrice: 0,
  currency: 'peso_Argentino',
  openInterest: 0,
  operationCount: 8864,
  settlement: 't1',
  minimumSheet: 1,
  lot: 1,
  minimumQuantity: 1,
  depth: [
    { buyQuantity: 1, buyPrice: 7500, sellPrice: 8050, sellQuantity: 85 },
    { buyQuantity: 65, buyPrice: 7450, sellPrice: 8500, sellQuantity: 10 },
    { buyQuantity: 0, buyPrice: 0, sellPrice: 8540, sellQuantity: 24 },
    { buyQuantity: 0, buyPrice: 0, sellPrice: 8600, sellQuantity: 7 },
    { buyQuantity: 0, buyPrice: 0, sellPrice: 8680, sellQuantity: 1 },
  ],
}

function PageContentHarness() {
  const [range, setRange] = useState<StockHistoryRange>('1M')

  return (
    <StockDetailsContent
      stock={stock}
      variant="page"
      historyRange={range}
      onHistoryRangeChange={setRange}
      history={pageHistory}
    />
  )
}

describe('StockDetailsContent variants', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-24T01:30:00.000Z'))
    chartMocks.advancedPoints.mockClear()
    chartMocks.simplePoints.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the stale history warning visible', () => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={vi.fn()}
        history={{
          ...pageHistory,
          meta: {
            ...pageHistory.meta,
            resolvedVariant: 'ajustada',
            source: 'live',
            stale: true,
          },
        }}
      />
    )

    expect(
      screen.getByText(
        'Mostrando histórico cacheado por una falla temporal del upstream.'
      )
    ).not.toBeNull()
    expect(screen.getByText('Stale')).not.toBeNull()
  })

  it('identifies a live unadjusted history without presenting it as an error', () => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={vi.fn()}
        history={{
          ...pageHistory,
          meta: {
            ...pageHistory.meta,
            resolvedVariant: 'sinAjustar',
            source: 'live',
          },
        }}
      />
    )

    expect(screen.getByText('Live · Sin ajustar')).not.toBeNull()
    expect(
      screen.getByText(
        'Se está mostrando histórico sin ajustar porque no había histórico ajustado disponible.'
      )
    ).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps stale and unadjusted signals visible together', () => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={vi.fn()}
        history={{
          ...pageHistory,
          meta: {
            ...pageHistory.meta,
            resolvedVariant: 'sinAjustar',
            source: 'live',
            stale: true,
          },
        }}
      />
    )

    expect(screen.getByText('Stale · Sin ajustar')).not.toBeNull()
    expect(
      screen.getByText(
        'Mostrando histórico sin ajustar cacheado por una falla temporal del upstream.'
      )
    ).not.toBeNull()
  })

  it.each([
    [3, 0, 8, 'Se descartaron 3 registros inválidos del upstream; se muestran 8 ruedas.'],
    [0, 1374, 1220, 'Se consolidaron 1374 registros repetidos; se muestran 1220 ruedas.'],
    [4, 1370, 1220, 'Se consolidaron 1370 registros repetidos y se descartaron 4 registros inválidos del upstream; se muestran 1220 ruedas.'],
    [1, 0, 1, 'Se descartó 1 registro inválido del upstream; se muestra 1 rueda.'],
    [0, 1, 1, 'Se consolidó 1 registro repetido; se muestra 1 rueda.'],
    [1, 1, 1, 'Se consolidó 1 registro repetido y se descartó 1 registro inválido del upstream; se muestra 1 rueda.'],
  ] as const)('distinguishes %i invalid and %i duplicate rows', (invalidPoints, duplicatePoints, totalPoints, message) => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={vi.fn()}
        history={{
          ...pageHistory,
          meta: {
            ...pageHistory.meta,
            invalidPoints,
            duplicatePoints,
            discardedPoints: invalidPoints + duplicatePoints,
            totalPoints,
          },
        }}
      />
    )

    const notice = screen.getByText(message)
    expect(notice.classList.contains('stock-history-subtitle-info')).toBe(invalidPoints === 0)
    expect(screen.queryByText(/3 de 8/)).toBeNull()
    expect(screen.getByText('Último mes:')).not.toBeNull()
  })

  it('omits the discarded-points message when the count is zero', () => {
    render(<PageContentHarness />)

    expect(screen.queryByText(/Se descartaron/)).toBeNull()
    expect(screen.queryByText(/Se consolid/)).toBeNull()
    expect(
      screen.getByText('Serie histórica de demo determinística.')
    ).not.toBeNull()
    expect(screen.getByText('Último mes:')).not.toBeNull()
  })

  it('keeps demo history bounded in modal mode and omits period metrics', () => {
    render(<StockDetailsContent stock={stock} />)

    expect(screen.getByTestId('simple-chart')).not.toBeNull()
    expect(screen.queryByTestId('advanced-chart')).toBeNull()
    expect(screen.queryByLabelText('Métricas del período')).toBeNull()
    expect(screen.queryByText('Datos de cotización')).toBeNull()
    expect(screen.getByText('Último precio')).not.toBeNull()
    expect(screen.getByText('Cantidad compra')).not.toBeNull()
    expect(screen.getByText('Precio venta')).not.toBeNull()
    expect(screen.getByText('Variación diaria')).not.toBeNull()
    expect(screen.getByRole('button', { name: '1M' })).not.toBeNull()

    const lastPrice = screen.getByText('Último precio')
    const dailyVariation = screen.getByText('Variación diaria')
    const historyTitle = screen.getByRole('heading', {
      level: 2,
      name: 'Histórico',
    })
    const buyQuantity = screen.getByText('Cantidad compra')

    expect(
      lastPrice.compareDocumentPosition(historyTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
    expect(
      dailyVariation.compareDocumentPosition(historyTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
    expect(
      historyTitle.compareDocumentPosition(buyQuantity) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
    expect(screen.getByText('Último mes:').textContent).toContain('+10,00%')
    expect(screen.queryByText(/Precio sincronizado/)).toBeNull()
    expect(screen.queryByText(/Historico actualizado/)).toBeNull()
    expect(chartMocks.simplePoints).toHaveBeenLastCalledWith([
      expect.objectContaining({ date: '2026-05-01', close: 100 }),
      expect.objectContaining({ date: '2026-05-02', close: 110 }),
    ])
  })

  it('uses the current snapshot for current metrics and history for period metrics', () => {
    render(<PageContentHarness />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Histórico' })
    ).not.toBeNull()
    expect(screen.getByText('Último mes:').textContent).toContain('+10,00%')
    expect(screen.getByLabelText('Tipo de gráfico')).not.toBeNull()
    expect(screen.getByText('Período')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '1W' }))

    expect(screen.getByText('Última semana:').textContent).toContain('+10,00%')
    expect(
      screen.getByRole('button', { name: '1W' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(screen.getByTestId('advanced-chart')).not.toBeNull()
    expect(screen.queryByTestId('simple-chart')).toBeNull()
    const periodMetrics = screen.getByRole('region', {
      name: 'Resumen del período',
    })

    expect(within(periodMetrics).getByText('Precio actual')).not.toBeNull()
    expect(
      within(periodMetrics).getByText('Variación del período')
    ).not.toBeNull()
    expect(
      within(periodMetrics).getByText('Máximo del período')
    ).not.toBeNull()
    expect(
      within(periodMetrics).getByText('Mínimo del período')
    ).not.toBeNull()
    expect(within(periodMetrics).queryByText(/Volumen/i)).toBeNull()
    expect(screen.queryByText('Volumen promedio')).toBeNull()
    expect(screen.queryByText('Último precio')).toBeNull()

    const quoteSection = screen.getByRole('region', {
      name: 'Cotización diaria',
    })
    const liquiditySection = screen.getByRole('region', { name: 'Liquidez' })
    const marketDepth = screen.getByRole('region', { name: 'Puntas' })

    expect(within(quoteSection).getByText('Apertura')).not.toBeNull()
    expect(within(quoteSection).getByText('Cierre anterior')).not.toBeNull()
    expect(within(quoteSection).getByText('Mínimo diario')).not.toBeNull()
    expect(within(quoteSection).getByText('Máximo diario')).not.toBeNull()
    expect(within(quoteSection).queryByText('Variación diaria')).toBeNull()
    expect(
      within(quoteSection).getByText('Cierre anterior').nextElementSibling
        ?.textContent
    ).toBe('$ 108,00')
    expect(within(quoteSection).queryByText('+1,50%')).toBeNull()
    expect(within(quoteSection).queryByText('Precio promedio')).toBeNull()
    expect(
      quoteSection.querySelectorAll('.stock-detail-secondary-metric')
    ).toHaveLength(4)
    expect(within(quoteSection).getByText('Demo')).not.toBeNull()
    expect(within(liquiditySection).getByText('Volumen nominal')).not.toBeNull()
    expect(within(liquiditySection).getByText('Monto operado')).not.toBeNull()
    expect(within(liquiditySection).getByText('$ 330.000,00')).not.toBeNull()
    expect(
      within(liquiditySection).getByText('Cantidad de operaciones')
    ).not.toBeNull()
    expect(within(liquiditySection).getByText('0')).not.toBeNull()
    expect(within(marketDepth).getByText('Cant. compra')).not.toBeNull()
    expect(within(marketDepth).getAllByText('10').length).toBeGreaterThan(0)
    expect(
      within(marketDepth).getAllByText('Precio compra').length
    ).toBeGreaterThan(0)
    expect(
      within(marketDepth).getAllByText('$ 109,00').length
    ).toBeGreaterThan(0)
    expect(
      within(marketDepth).getAllByText('Precio venta').length
    ).toBeGreaterThan(0)
    expect(
      within(marketDepth).getAllByText('$ 111,00').length
    ).toBeGreaterThan(0)
    expect(within(marketDepth).getByText('Cant. venta')).not.toBeNull()
    expect(within(marketDepth).getAllByText('20').length).toBeGreaterThan(0)
    expect(marketDepth.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(within(liquiditySection).getByText('ARS')).not.toBeNull()
    expect(chartMocks.advancedPoints).toHaveBeenLastCalledWith([
      expect.objectContaining({ date: '2026-05-01', close: 100 }),
      expect.objectContaining({ date: '2026-05-02', close: 110 }),
      expect.objectContaining({ date: '2026-05-03', close: 110 }),
    ])
  })

  it('syncs the latest quote into the daily chart when it has a market date', () => {
    render(<PageContentHarness />)

    expect(screen.getAllByText('$ 110,00').length).toBeGreaterThan(0)
    expect(
      chartMocks.advancedPoints.mock.calls.at(-1)?.[0].some(
        (point: { date: string }) => point.date === '2026-05-03'
      )
    ).toBe(true)
  })

  it('adds a live session candle from CotizacionDetalle during market hours', () => {
    vi.setSystemTime(new Date('2026-06-24T19:59:56.000Z'))

    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={() => undefined}
        history={pageHistory}
        quoteDetail={quoteDetail}
        quoteSource="live"
      />
    )

    expect(chartMocks.advancedPoints).toHaveBeenLastCalledWith([
      ...pageHistory.points,
      expect.objectContaining({
        date: '2026-06-24',
        close: 7615,
      }),
    ])
  })

  it('does not extend demo history with a quote outside its date range', () => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={() => undefined}
        history={pageHistory}
        quoteDetail={quoteDetail}
        quoteSource="demo"
      />
    )

    expect(chartMocks.advancedPoints).toHaveBeenLastCalledWith(pageHistory.points)
  })

  it('renders CotizacionDetalle metrics and every market-depth row', () => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={() => undefined}
        history={pageHistory}
        quoteDetail={quoteDetail}
      />
    )

    const quoteSection = screen.getByRole('region', {
      name: 'Cotización diaria',
    })
    const liquiditySection = screen.getByRole('region', { name: 'Liquidez' })
    const marketDepth = screen.getByRole('region', { name: 'Puntas' })

    expect(
      within(quoteSection).getByText('Cierre anterior').nextElementSibling
        ?.textContent
    ).toBe('$ 7.960,00')
    expect(within(liquiditySection).getByText('$ 20.190.703.365,00')).not.toBeNull()
    expect(within(liquiditySection).getByText('8.864')).not.toBeNull()
    expect(marketDepth.querySelectorAll('tbody tr')).toHaveLength(5)
    expect(within(marketDepth).getAllByText('0').length).toBeGreaterThan(0)
    expect(within(marketDepth).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('renders mobile market-depth cards with complete labels and values', () => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={() => undefined}
        history={pageHistory}
        quoteDetail={quoteDetail}
      />
    )

    const marketDepth = screen.getByRole('region', { name: 'Puntas' })
    const mobileDepth = marketDepth.querySelector(
      '.stock-detail-market-depth-mobile'
    )
    const firstCard = mobileDepth?.querySelector(
      '.stock-detail-market-depth-card'
    )

    expect(mobileDepth).not.toBeNull()
    expect(firstCard).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByLabelText(
        'Precio compra: $ 7.500,00'
      )
    ).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByLabelText('Cantidad compra: 1')
    ).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByLabelText(
        'Precio venta: $ 8.050,00'
      )
    ).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByLabelText('Cantidad venta: 85')
    ).not.toBeNull()
    expect(within(firstCard as HTMLElement).getByText('Compra')).not.toBeNull()
    expect(within(firstCard as HTMLElement).getByText('Venta')).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByText('$ 7.500,00')
    ).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByText('$ 8.050,00')
    ).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByText('Cantidad: 1')
    ).not.toBeNull()
    expect(
      within(firstCard as HTMLElement).getByText('Cantidad: 85')
    ).not.toBeNull()
    expect(firstCard?.textContent).not.toContain('Precio compra')
    expect(firstCard?.textContent).not.toContain('Precio venta')
    expect(firstCard?.textContent).not.toContain('...')
  })

  it('renders an empty market-depth state', () => {
    render(
      <StockDetailsContent
        stock={stock}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={() => undefined}
        history={pageHistory}
        quoteDetail={{ ...quoteDetail, depth: [] }}
      />
    )

    expect(screen.getByText('Sin puntas disponibles')).not.toBeNull()
  })

  it('calculates the modal previous close when snapshot close repeats price', () => {
    render(
      <StockDetailsContent
        stock={{
          ...stock,
          price: 7615,
          var: -4.33,
          varType: 'negative',
          close: 7615,
        }}
      />
    )

    const previousCloseValue = screen.getByText('Cierre anterior')
      .nextElementSibling

    expect(previousCloseValue?.textContent).toBe('$ 7.959,65')
  })

  it('renders an informed zero amount as currency', () => {
    render(
      <StockDetailsContent
        stock={{ ...stock, amountTraded: 0 }}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={() => undefined}
        history={pageHistory}
      />
    )

    const liquiditySection = screen.getByRole('region', { name: 'Liquidez' })

    expect(within(liquiditySection).getByText('$ 0,00')).not.toBeNull()
  })

  it('renders a dash when amount traded is unavailable in both sources', () => {
    render(
      <StockDetailsContent
        stock={{ ...stock, amountTraded: null }}
        variant="page"
        historyRange="1M"
        onHistoryRangeChange={() => undefined}
        history={{
          ...pageHistory,
          points: pageHistory.points.map((point) => ({
            ...point,
            amountTraded: undefined,
          })),
        }}
      />
    )

    const liquiditySection = screen.getByRole('region', { name: 'Liquidez' })
    const amountValue = within(liquiditySection)
      .getByText('Monto operado')
      .nextElementSibling

    expect(amountValue?.textContent).toBe('—')
  })
})
