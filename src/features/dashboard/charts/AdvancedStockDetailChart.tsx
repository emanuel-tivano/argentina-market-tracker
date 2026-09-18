'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type AreaData,
  type CandlestickData,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  formatCurrencyARS,
  formatDateTick,
  formatPercentage,
} from '@/lib/formatters'
import { type StockHistoryPoint } from '@/lib/stockHistory'
import {
  calculateDailyVariationPercentage,
  isSuspiciousPriceTransition,
} from '@/lib/marketPerformance'
import { THEME_CHANGE_EVENT } from '@/lib/theme'
import {
  hasSufficientCandles,
  normalizeCandles,
  normalizeHistoryPoints,
  type NormalizedHistoryPoint,
} from '@/features/dashboard/charts/advancedStockChart'
import {
  formatPriceLabel,
  getChartTheme,
  type ChartTheme,
} from '@/features/dashboard/charts/stockChartTheme'

type AdvancedStockDetailChartProps = {
  points: StockHistoryPoint[]
  symbol: string
  rangeControls?: ReactNode
}

type ChartType = 'area' | 'candles'

type TooltipData = {
  point: NormalizedHistoryPoint
  dailyVariation: number | null
  left: number
  top: number
}

const CHART_HEIGHT = 420

function formatDateLabel(value: Time): string {
  if (typeof value === 'object' && value !== null && 'year' in value) {
    return formatDateTick(
      `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
    )
  }

  return formatDateTick(value)
}

function getTrendColor(
  points: NormalizedHistoryPoint[],
  theme: ChartTheme
): string {
  const first = points[0]
  const last = points.at(-1)

  if (!first || !last || first.close === last.close) {
    return theme.neutral
  }

  return last.close > first.close ? theme.positive : theme.negative
}

export default function AdvancedStockDetailChart({
  points,
  symbol,
  rangeControls,
}: AdvancedStockDetailChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const normalizedPoints = useMemo(() => normalizeHistoryPoints(points), [points])
  const candles = useMemo(
    () => normalizeCandles(normalizedPoints),
    [normalizedPoints]
  )
  const pointByTime = useMemo(
    () => new Map(normalizedPoints.map((point) => [point.time, point])),
    [normalizedPoints]
  )
  const dailyVariationByTime = useMemo(() => {
    return new Map(
      normalizedPoints.map((point, index) => {
        const previousClose = normalizedPoints[index - 1]?.close
        const previousPoint = normalizedPoints[index - 1]
        const variation =
          previousClose === undefined ||
          (previousPoint && isSuspiciousPriceTransition(previousPoint, point))
            ? null
            : calculateDailyVariationPercentage(previousClose, point.close)

        return [point.time, variation] as const
      })
    )
  }, [normalizedPoints])
  const [chartType, setChartType] = useState<ChartType>('candles')
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [themeRevision, setThemeRevision] = useState(0)
  const canRenderCandles = hasSufficientCandles(normalizedPoints, candles)
  const effectiveChartType =
    chartType === 'candles' && !canRenderCandles ? 'area' : chartType

  useEffect(() => {
    function handleThemeChange() {
      setThemeRevision((revision) => revision + 1)
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange)

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current

    if (!container || normalizedPoints.length === 0) {
      return
    }

    const chartTheme = getChartTheme()
    const trendColor = getTrendColor(normalizedPoints, chartTheme)
    const chart = createChart(container, {
      width: container.clientWidth,
      height: CHART_HEIGHT,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.text,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      grid: {
        vertLines: { color: chartTheme.gridVert },
        horzLines: { color: chartTheme.gridHorz },
      },
      rightPriceScale: {
        borderColor: chartTheme.border,
        scaleMargins: {
          top: 0.08,
          bottom: 0.12,
        },
      },
      timeScale: {
        borderColor: chartTheme.border,
        timeVisible: false,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkMaxCharacterLength: 10,
        tickMarkFormatter: (time: Time) => formatDateLabel(time),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: chartTheme.crosshairVert,
          style: LineStyle.Solid,
          width: 1,
          labelBackgroundColor: chartTheme.labelBackground,
        },
        horzLine: {
          color: chartTheme.crosshairHorz,
          style: LineStyle.Solid,
          width: 1,
          labelBackgroundColor: chartTheme.labelBackground,
        },
      },
      localization: {
        priceFormatter: (price: number) => formatPriceLabel(price),
        timeFormatter: (time: Time) => formatDateLabel(time),
      },
      handleScroll: true,
      handleScale: true,
    })

    const areaData = normalizedPoints.map(({ time, close }) => ({
      time: time as UTCTimestamp,
      value: close,
    }))

    if (effectiveChartType === 'candles') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: chartTheme.positive,
        downColor: chartTheme.negative,
        borderVisible: false,
        wickUpColor: chartTheme.positive,
        wickDownColor: chartTheme.negative,
        priceLineVisible: false,
      })

      candleSeries.setData(
        candles.map((candle) => ({
          ...candle,
          time: candle.time as UTCTimestamp,
        })) as CandlestickData[]
      )
    } else {
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: trendColor,
        topColor: `${trendColor}44`,
        bottomColor: `${trendColor}00`,
        lineWidth: 2,
        priceLineVisible: false,
      })

      areaSeries.setData(areaData as AreaData[])
    }

    chart.subscribeCrosshairMove((param) => {
      if (
        typeof param.time !== 'number' ||
        !param.point ||
        param.point.x < 0 ||
        param.point.y < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y > CHART_HEIGHT
      ) {
        setTooltip(null)
        return
      }

      const point = pointByTime.get(param.time)

      if (!point) {
        setTooltip(null)
        return
      }

      const tooltipWidth = 220
      const left =
        param.point.x > container.clientWidth - tooltipWidth - 24
          ? param.point.x - tooltipWidth - 12
          : param.point.x + 12

      setTooltip({
        point,
        dailyVariation: dailyVariationByTime.get(point.time) ?? null,
        left: Math.max(8, left),
        top: Math.max(8, Math.min(param.point.y - 36, CHART_HEIGHT - 210)),
      })
    })

    chart.timeScale().fitContent()

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]

      if (!entry) {
        return
      }

      chart.applyOptions({
        width: Math.floor(entry.contentRect.width),
        height: CHART_HEIGHT,
      })
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      setTooltip(null)
      chart.remove()
    }
  }, [
    candles,
    dailyVariationByTime,
    effectiveChartType,
    normalizedPoints,
    pointByTime,
    themeRevision,
  ])

  if (normalizedPoints.length === 0) {
    return (
      <div className="advanced-stock-chart advanced-stock-chart-empty">
        Sin histórico disponible
      </div>
    )
  }

  return (
    <div className="advanced-stock-chart">
      <div className="advanced-stock-chart-toolbar">
        <label className="advanced-stock-chart-select">
          <span>Tipo de gráfico</span>
          <select
            value={chartType}
            onChange={(event) => setChartType(event.target.value as ChartType)}
          >
            <option value="candles">Velas</option>
            <option value="area">Área</option>
          </select>
        </label>

        {rangeControls}
      </div>

      {chartType === 'candles' && !canRenderCandles && (
        <p className="advanced-stock-chart-fallback" role="status">
          No hay suficientes datos OHLC válidos. Se muestra el gráfico de área.
        </p>
      )}
      
      <div className="advanced-stock-chart-canvas">
        <div
          ref={containerRef}
          className="advanced-stock-chart-container"
          role="img"
          aria-label={`Gráfico avanzado de ${symbol}`}
        />

        {tooltip && (
          <dl
            className="advanced-stock-chart-tooltip"
            style={{ left: tooltip.left, top: tooltip.top }}
          >
            <div className="advanced-stock-chart-tooltip-date">
              <dt>Fecha</dt>
              <dd>{tooltip.point.date}</dd>
            </div>
            <div>
              <dt>Apertura</dt>
              <dd>
                {tooltip.point.open === undefined
                  ? '-'
                  : formatCurrencyARS(tooltip.point.open)}
              </dd>
            </div>
            <div>
              <dt>Máximo</dt>
              <dd>
                {tooltip.point.high === undefined
                  ? '-'
                  : formatCurrencyARS(tooltip.point.high)}
              </dd>
            </div>
            <div>
              <dt>Mínimo</dt>
              <dd>
                {tooltip.point.low === undefined
                  ? '-'
                  : formatCurrencyARS(tooltip.point.low)}
              </dd>
            </div>
            <div>
              <dt>Cierre</dt>
              <dd>{formatCurrencyARS(tooltip.point.close)}</dd>
            </div>
            <div>
              <dt>Variación</dt>
              <dd>
                {tooltip.dailyVariation === null
                  ? '-'
                  : formatPercentage(tooltip.dailyVariation)}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}
