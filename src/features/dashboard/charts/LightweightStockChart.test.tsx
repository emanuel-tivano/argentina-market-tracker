// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type StockHistoryPoint } from '@/lib/stockHistory'
import { normalizeStockHistoryDataResult } from '@/lib/stockHistory'
import LightweightStockChart from '@/features/dashboard/charts/LightweightStockChart'

const chartMocks = vi.hoisted(() => {
  const setData = vi.fn()
  const fitContent = vi.fn()
  const applyOptions = vi.fn()
  const remove = vi.fn()
  const addSeries = vi.fn(() => ({ setData }))
  const createChart = vi.fn(() => ({
    addSeries,
    applyOptions,
    remove,
    timeScale: () => ({ fitContent }),
  }))

  return {
    addSeries,
    applyOptions,
    createChart,
    fitContent,
    remove,
    setData,
  }
})

vi.mock('lightweight-charts', () => ({
  AreaSeries: 'AreaSeries',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  LineSeries: 'LineSeries',
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

describe('LightweightStockChart', () => {
  beforeEach(() => {
    chartMocks.addSeries.mockClear()
    chartMocks.applyOptions.mockClear()
    chartMocks.createChart.mockClear()
    chartMocks.fitContent.mockClear()
    chartMocks.remove.mockClear()
    chartMocks.setData.mockClear()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders a fallback when there is no historical data', () => {
    render(<LightweightStockChart points={[]} symbol="AAPL" />)

    expect(screen.getByText('Sin histórico disponible')).not.toBeNull()
    expect(chartMocks.createChart).not.toHaveBeenCalled()
  })

  it('creates an area chart with historical data', () => {
    render(
      <LightweightStockChart
        symbol="GGAL"
        points={[
          { date: '2026-05-06', close: 101 },
          { date: '2026-05-07', close: 103 },
        ]}
      />
    )

    expect(
      screen.getByRole('img', {
        name: 'Evolución del precio de cierre de GGAL',
      })
    ).not.toBeNull()
    expect(chartMocks.createChart).toHaveBeenCalledTimes(1)
    expect(chartMocks.addSeries).toHaveBeenCalledWith(
      'AreaSeries',
      expect.objectContaining({ lineColor: '#008f5a' })
    )
    expect(chartMocks.setData).toHaveBeenCalledWith([
      { time: timestamp('2026-05-06'), value: 101 },
      { time: timestamp('2026-05-07'), value: 103 },
    ])
  })

  it('sorts unordered historical data before passing it to the chart', () => {
    render(
      <LightweightStockChart
        symbol="GGAL"
        points={[
          { date: '2026-05-08', close: 104 },
          { date: '2026-05-06', close: 101 },
          { date: '2026-05-07', close: 103 },
        ]}
      />
    )

    expect(chartMocks.setData).toHaveBeenCalledWith([
      { time: timestamp('2026-05-06'), value: 101 },
      { time: timestamp('2026-05-07'), value: 103 },
      { time: timestamp('2026-05-08'), value: 104 },
    ])
  })

  it('deduplicates repeated dates and keeps the last valid value', () => {
    render(
      <LightweightStockChart
        symbol="AAPL"
        points={[
          { date: '2026-05-06', close: 101 },
          { date: '2026-05-07', close: 103 },
          { date: '2026-05-06', close: 102 },
        ]}
      />
    )

    expect(chartMocks.setData).toHaveBeenCalledWith([
      { time: timestamp('2026-05-06'), value: 102 },
      { time: timestamp('2026-05-07'), value: 103 },
    ])
  })

  it('renders a synchronized current market date as the final line point', () => {
    render(
      <LightweightStockChart
        symbol="ALUA"
        points={[
          { date: '2026-09-23', close: 852 },
          { date: '2026-09-24', close: 841.5 },
        ]}
      />
    )

    expect(chartMocks.setData).toHaveBeenCalledWith([
      { time: timestamp('2026-09-23'), value: 852 },
      { time: timestamp('2026-09-24'), value: 841.5 },
    ])
  })

  it('passes server-normalized unique dates directly to the chart library', () => {
    const normalized = normalizeStockHistoryDataResult([
      { fechaHora: '2026-05-07T11:00:00', ultimoPrecio: 101 },
      { fecha: '2026-05-06', ultimoPrecio: 99 },
      { fechaHora: '2026-05-07T17:00:00', ultimoPrecio: 103 },
    ])

    render(<LightweightStockChart symbol="GGAL" points={normalized.data} />)

    expect(normalized.totalPoints).toBe(normalized.data.length)
    expect(normalized.discardedPoints).toBe(1)
    expect(chartMocks.setData).toHaveBeenCalledWith([
      { time: timestamp('2026-05-06'), value: 99 },
      { time: timestamp('2026-05-07'), value: 103 },
    ])
  })

  it('filters invalid dates and prices before rendering', () => {
    render(
      <LightweightStockChart
        symbol="MSFT"
        points={
          [
            { date: '', close: 101 },
            { date: 'invalid-date', close: 102 },
            { date: '2026-99-99', close: 998 },
            { date: '2026-02-30', close: 999 },
            { date: '2026-05-06', close: Number.NaN },
            { date: '2026-05-07', close: 103 },
          ] as StockHistoryPoint[]
        }
      />
    )

    expect(chartMocks.setData).toHaveBeenCalledWith([
      { time: timestamp('2026-05-07'), value: 103 },
    ])
  })

  it('renders the fallback when normalization removes every point', () => {
    render(
      <LightweightStockChart
        symbol="KO"
        points={
          [
            { date: '', close: Number.NaN },
            { date: 'not-a-date', close: 120 },
          ] as StockHistoryPoint[]
        }
      />
    )

    expect(screen.getByText('Sin histórico disponible')).not.toBeNull()
    expect(chartMocks.createChart).not.toHaveBeenCalled()
  })

  it('normalizes CEDEAR-like repeated timestamps into strictly ascending data', () => {
    render(
      <LightweightStockChart
        symbol="MELI"
        points={[
          { date: '2026-05-08T00:00:00.000Z', close: 1460 },
          { date: '2026-05-07T00:00:00.000Z', close: 1400 },
          { date: '2026-05-08', close: 1475 },
          { date: '2026-05-09', close: 1482 },
          { date: '2026-05-07', close: 1415 },
        ]}
      />
    )

    expect(chartMocks.setData).toHaveBeenCalledWith([
      { time: timestamp('2026-05-07'), value: 1415 },
      { time: timestamp('2026-05-08'), value: 1475 },
      { time: timestamp('2026-05-09'), value: 1482 },
    ])
  })

  it('supports line charts and removes the chart on unmount', () => {
    const { unmount } = render(
      <LightweightStockChart
        type="line"
        symbol="YPFD"
        points={[{ date: '2026-05-07', close: 101 }]}
      />
    )

    expect(chartMocks.addSeries).toHaveBeenCalledWith(
      'LineSeries',
      expect.objectContaining({ color: '#1c36be' })
    )

    unmount()

    expect(chartMocks.remove).toHaveBeenCalledTimes(1)
  })
})
