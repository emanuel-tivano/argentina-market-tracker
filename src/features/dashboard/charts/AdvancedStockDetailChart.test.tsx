// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdvancedStockDetailChart from '@/features/dashboard/charts/AdvancedStockDetailChart'
import { normalizeStockHistoryDataResult } from '@/lib/stockHistory'

const chartMocks = vi.hoisted(() => {
  const setData = vi.fn()
  const applyPriceScaleOptions = vi.fn()
  const addSeries = vi.fn(() => ({
    setData,
    priceScale: () => ({ applyOptions: applyPriceScaleOptions }),
  }))
  const fitContent = vi.fn()
  const remove = vi.fn()
  const subscribeCrosshairMove = vi.fn()
  const createChart = vi.fn(() => ({
    addSeries,
    applyOptions: vi.fn(),
    remove,
    subscribeCrosshairMove,
    timeScale: () => ({ fitContent }),
  }))

  return {
    addSeries,
    createChart,
    fitContent,
    remove,
    setData,
    subscribeCrosshairMove,
  }
})

vi.mock('lightweight-charts', () => ({
  AreaSeries: 'AreaSeries',
  CandlestickSeries: 'CandlestickSeries',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  HistogramSeries: 'HistogramSeries',
  LineStyle: { Solid: 0 },
  createChart: chartMocks.createChart,
}))

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

function timestamp(date: string) {
  return Math.floor(Date.parse(date) / 1000)
}

const completeOhlcPoints = [
  {
    date: '2026-06-22',
    open: 99,
    high: 103,
    low: 98,
    close: 101,
    volume: 1000,
  },
  {
    date: '2026-06-23',
    open: 101,
    high: 106,
    low: 100,
    close: 105,
    volume: 1500,
  },
]

describe('AdvancedStockDetailChart', () => {
  beforeEach(() => {
    chartMocks.addSeries.mockClear()
    chartMocks.createChart.mockClear()
    chartMocks.fitContent.mockClear()
    chartMocks.remove.mockClear()
    chartMocks.setData.mockClear()
    chartMocks.subscribeCrosshairMove.mockClear()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('offers only Candles and Area, defaults to Candles and omits indicators', () => {
    render(
      <AdvancedStockDetailChart points={completeOhlcPoints} symbol="GGAL" />
    )

    const selector = screen.getByLabelText('Tipo de gráfico')
    const options = Array.from(
      (selector as HTMLSelectElement).options,
      (option) => option.text
    )

    expect((selector as HTMLSelectElement).value).toBe('candles')
    expect(options).toEqual(['Velas', 'Área'])
    expect(screen.queryByText('Línea')).toBeNull()
    expect(screen.queryByText('Indicadores')).toBeNull()
    expect(screen.queryByText('SMA 20')).toBeNull()
    expect(screen.queryByText('SMA 50')).toBeNull()
    expect(chartMocks.addSeries).toHaveBeenCalledWith(
      'CandlestickSeries',
      expect.any(Object)
    )
    expect(chartMocks.addSeries).not.toHaveBeenCalledWith(
      'HistogramSeries',
      expect.any(Object)
    )
  })

  it('renders candles when every point has complete OHLC data', () => {
    render(
      <AdvancedStockDetailChart points={completeOhlcPoints} symbol="GGAL" />
    )

    expect(chartMocks.addSeries).toHaveBeenCalledWith(
      'CandlestickSeries',
      expect.any(Object)
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(chartMocks.fitContent).toHaveBeenCalled()
  })

  it('renders the synchronized current market date with exact quote OHLC', () => {
    render(
      <AdvancedStockDetailChart
        symbol="ALUA"
        points={[
          {
            date: '2026-09-23',
            open: 850,
            high: 855,
            low: 848,
            close: 852,
          },
          {
            date: '2026-09-24',
            open: 842,
            high: 845,
            low: 840,
            close: 841.5,
          },
        ]}
      />
    )

    expect(chartMocks.setData).toHaveBeenCalledWith([
      expect.objectContaining({
        time: timestamp('2026-09-23'),
        open: 850,
        high: 855,
        low: 848,
        close: 852,
      }),
      expect.objectContaining({
        time: timestamp('2026-09-24'),
        open: 842,
        high: 845,
        low: 840,
        close: 841.5,
      }),
    ])
  })

  it('allows full DD/MM/YYYY labels on the time axis', () => {
    render(
      <AdvancedStockDetailChart points={completeOhlcPoints} symbol="GGAL" />
    )

    expect(chartMocks.createChart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeScale: expect.objectContaining({
          tickMarkMaxCharacterLength: 10,
        }),
      })
    )
  })

  it('receives unique server-normalized dates without dropping chart points', () => {
    const normalized = normalizeStockHistoryDataResult([
      {
        fechaHora: '2026-06-23T11:00:00',
        apertura: 101,
        maximo: 106,
        minimo: 100,
        ultimoPrecio: 104,
      },
      {
        fecha: '2026-06-22',
        apertura: 99,
        maximo: 103,
        minimo: 98,
        ultimoPrecio: 101,
      },
      {
        fechaHora: '2026-06-23T17:00:00',
        apertura: 102,
        maximo: 107,
        minimo: 101,
        ultimoPrecio: 105,
      },
    ])

    render(<AdvancedStockDetailChart points={normalized.data} symbol="GGAL" />)

    expect(normalized.data).toHaveLength(2)
    expect(chartMocks.setData).toHaveBeenCalledWith([
      expect.objectContaining({ close: 101 }),
      expect.objectContaining({ close: 105 }),
    ])
  })

  it('falls back from Candles to Area when OHLC data is incomplete', () => {
    render(
      <AdvancedStockDetailChart
        symbol="GGAL"
        points={[
          { date: '2026-06-22', close: 101, volume: 1000 },
          { date: '2026-06-23', close: 105, volume: 1500 },
        ]}
      />
    )

    expect(screen.getByRole('status').textContent).toContain(
      'Se muestra el gráfico de área'
    )
    expect(chartMocks.addSeries).toHaveBeenCalledWith(
      'AreaSeries',
      expect.any(Object)
    )
    expect(chartMocks.addSeries).not.toHaveBeenCalledWith(
      'CandlestickSeries',
      expect.any(Object)
    )
    expect(chartMocks.createChart).toHaveBeenCalledTimes(1)
  })

  it('switches explicitly from Candles to Area', () => {
    render(
      <AdvancedStockDetailChart points={completeOhlcPoints} symbol="GGAL" />
    )

    fireEvent.change(screen.getByLabelText('Tipo de gráfico'), {
      target: { value: 'area' },
    })

    expect(chartMocks.addSeries).toHaveBeenLastCalledWith(
      'AreaSeries',
      expect.any(Object)
    )
    expect(chartMocks.addSeries).not.toHaveBeenCalledWith(
      'HistogramSeries',
      expect.any(Object)
    )
  })

  it('renders candles without volume data', () => {
    render(
      <AdvancedStockDetailChart
        symbol="GGAL"
        points={completeOhlcPoints.map(
          ({ date, open, high, low, close }) => ({
            date,
            open,
            high,
            low,
            close,
          })
        )}
      />
    )

    expect(chartMocks.addSeries).toHaveBeenCalledWith(
      'CandlestickSeries',
      expect.any(Object)
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('omits volume from the crosshair tooltip', () => {
    const { container } = render(
      <AdvancedStockDetailChart points={completeOhlcPoints} symbol="GGAL" />
    )
    const chartContainer = container.querySelector(
      '.advanced-stock-chart-container'
    )

    expect(chartContainer).not.toBeNull()

    Object.defineProperty(chartContainer, 'clientWidth', {
      configurable: true,
      value: 800,
    })

    const crosshairHandler =
      chartMocks.subscribeCrosshairMove.mock.calls[0]?.[0]

    expect(crosshairHandler).toBeTypeOf('function')

    act(() => {
      crosshairHandler({
        time: Math.floor(Date.parse('2026-06-23') / 1000),
        point: { x: 100, y: 100 },
      })
    })

    expect(screen.getByText('2026-06-23')).toBeTruthy()
    expect(screen.getByText('Apertura')).toBeTruthy()
    expect(screen.getByText('Máximo')).toBeTruthy()
    expect(screen.getByText('Mínimo')).toBeTruthy()
    expect(screen.getByText('Cierre')).toBeTruthy()
    expect(screen.getByText('Variación')).toBeTruthy()
    expect(screen.queryByText(/volumen/i)).toBeNull()
  })

  it('keeps candles for a long range with isolated invalid OHLC points', () => {
    const longRangePoints = Array.from({ length: 90 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1))
        .toISOString()
        .slice(0, 10)
      const close = 100 + index

      return index === 45
        ? { date, close }
        : {
            date,
            open: close - 1,
            high: close + 2,
            low: close - 2,
            close,
          }
    })

    render(
      <AdvancedStockDetailChart points={longRangePoints} symbol="GGAL" />
    )

    expect(chartMocks.addSeries).toHaveBeenCalledWith(
      'CandlestickSeries',
      expect.any(Object)
    )
    expect(chartMocks.addSeries).not.toHaveBeenCalledWith(
      'AreaSeries',
      expect.any(Object)
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
