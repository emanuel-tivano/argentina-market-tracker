'use client'

import { useMemo, useState } from 'react'
import { type StockData } from '@/features/dashboard/shared/stockData'
import {
  formatInteger,
  formatMoney,
  formatSignedPercent,
} from '@/lib/formatters'
import {
  DEFAULT_STOCK_HISTORY_RANGE,
  type StockHistoryRange,
} from '@/lib/stockHistory'
import { useStockHistory } from '@/features/dashboard/stock-detail/useStockHistory'
import { useStockQuote } from '@/features/dashboard/stock-detail/useStockQuote'
import {
  calculatePeriodStats,
  normalizeHistoryPoints,
} from '@/features/dashboard/charts/advancedStockChart'
import {
  resolveCurrentStockQuote,
  syncHistoryWithCurrentQuote,
} from '@/features/dashboard/stock-detail/currentStockQuote'
import {
  getVariationClass,
  getVariationSeverityClass,
} from '@/features/dashboard/stocks/stockVariationSeverity'
import { type StockQuoteDetail } from '@/lib/stockQuote'
import {
  findSuspiciousPriceDiscontinuity,
  selectPerformanceWindow,
} from '@/lib/marketPerformance'
import {
  HistoryChartSection,
  HistoryRangeControls,
  HistorySectionHeader,
  HistoryStateContent,
  PageDetailDataSections,
  StockDetailsMetricGrid,
  type HistoryViewState,
  type StockDetailRow,
} from './StockDetailsSections'

type StockDetailsContentProps =
  | {
      stock: StockData
      variant?: 'modal'
    }
  | {
      stock: StockData
      variant: 'page'
      historyRange: StockHistoryRange
      onHistoryRangeChange: (range: StockHistoryRange) => void
      history: HistoryViewState
      quoteDetail?: StockQuoteDetail | null
      quoteSource?: 'demo' | 'live' | null
    }

function getHistoryVariationClass(value: number | null): string {
  if (value === null || value === 0) {
    return 'stock-history-performance-neutral'
  }

  return value > 0
    ? 'stock-history-performance-positive'
    : 'stock-history-performance-negative'
}

const HISTORY_DATA_QUALITY_MESSAGE =
  'Algunos datos históricos presentan inconsistencias y fueron omitidos.'

function HistorySection({
  stock,
  variant,
  historyRange,
  onHistoryRangeChange,
  history,
  quoteDetail,
  quoteSource,
}: {
  stock: StockData
  variant: 'modal' | 'page'
  historyRange: StockHistoryRange
  onHistoryRangeChange: (range: StockHistoryRange) => void
  history: HistoryViewState
  quoteDetail?: StockQuoteDetail | null
  quoteSource?: 'demo' | 'live' | null
}) {
  const currentQuote = useMemo(
    () => resolveCurrentStockQuote(stock, history.points, quoteDetail),
    [history.points, quoteDetail, stock]
  )
  const syncedHistory = useMemo(
    () =>
      syncHistoryWithCurrentQuote(history.points, currentQuote, {
        now: new Date(),
        quoteSource,
      }),
    [currentQuote, history.points, quoteSource]
  )
  const performanceWindow = useMemo(
    () => selectPerformanceWindow(syncedHistory.points, historyRange),
    [historyRange, syncedHistory.points]
  )
  const chartSeries = performanceWindow.start
    ? performanceWindow.points
    : syncedHistory.points
  const normalizedHistoryPoints = useMemo(
    () => normalizeHistoryPoints(chartSeries),
    [chartSeries]
  )
  const periodMetrics = useMemo(
    () => calculatePeriodStats(normalizedHistoryPoints),
    [normalizedHistoryPoints]
  )
  const isUnadjustedHistory =
    history.meta?.source === 'live' &&
    history.meta.resolvedVariant === 'sinAjustar'
  const suspiciousPriceDiscontinuity = useMemo(
    () => findSuspiciousPriceDiscontinuity(chartSeries),
    [chartSeries]
  )
  const periodVariation =
    performanceWindow.status === 'ok' &&
    !isUnadjustedHistory &&
    !suspiciousPriceDiscontinuity
      ? (periodMetrics?.periodVariation ?? null)
      : null
  const periodVariationClass = getHistoryVariationClass(periodVariation)
  const historyDataStatus = history.meta
    ? [
        history.meta.stale
          ? 'Stale'
          : history.meta.source === 'demo'
            ? 'Demo'
            : 'Live',
        history.meta.source === 'live' &&
        history.meta.resolvedVariant === 'sinAjustar'
          ? 'Sin ajustar'
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null
  const historyMetaMessage =
    history.viewStatus === 'success' && history.meta
      ? history.meta.stale
        ? isUnadjustedHistory
          ? 'Mostrando histórico sin ajustar cacheado por una falla temporal del upstream.'
          : 'Mostrando histórico cacheado por una falla temporal del upstream.'
        : isUnadjustedHistory
          ? 'Se está mostrando histórico sin ajustar porque no había histórico ajustado disponible.'
        : suspiciousPriceDiscontinuity
          ? 'La serie contiene un salto compatible con una acción societaria no ajustada; se omite el rendimiento.'
        : history.meta.invalidPoints > 0
          ? HISTORY_DATA_QUALITY_MESSAGE
        : performanceWindow.status === 'missing-reference' ||
            performanceWindow.status === 'insufficient'
          ? 'No hay una cotización de referencia suficiente para calcular el rendimiento del período.'
          : history.meta.source === 'demo'
            ? 'Serie histórica de demo determinística.'
            : null
      : null
  const historyRefreshMessage =
    history.viewStatus === 'success' && history.error
      ? `No se pudo actualizar el histórico: ${history.error.message}`
      : null
  const rangeControls = (
    <HistoryRangeControls
      range={historyRange}
      onChange={onHistoryRangeChange}
    />
  )

  return (
    <>
      <section
        className="stock-history-section"
        aria-labelledby="stock-history-title"
      >
        <HistorySectionHeader
          historyRange={historyRange}
          periodVariation={
            history.viewStatus === 'success' ? periodVariation : null
          }
          periodVariationClass={periodVariationClass}
          metaMessage={historyMetaMessage}
          metaInformational={
            !history.meta?.stale &&
            !isUnadjustedHistory &&
            history.meta?.invalidPoints === 0
          }
          refreshMessage={historyRefreshMessage}
          controls={variant === 'modal' ? rangeControls : null}
        />
        <HistoryStateContent history={history} />
        <HistoryChartSection
          stock={stock}
          variant={variant}
          history={history}
          chartSeries={chartSeries}
          rangeControls={rangeControls}
        />
      </section>

      {variant === 'page' && (
        <PageDetailDataSections
          currentQuote={currentQuote}
          periodMetrics={periodMetrics}
          periodVariation={periodVariation}
          periodVariationClass={periodVariationClass}
          historyDataStatus={historyDataStatus}
        />
      )}
    </>
  )
}

function StockDetailsModalContent({ stock }: { stock: StockData }) {
  const [historyRange, setHistoryRange] = useState<StockHistoryRange>(
    DEFAULT_STOCK_HISTORY_RANGE
  )
  const history = useStockHistory(stock.ticker, historyRange, undefined, {
    enabled: true,
  })
  const quote = useStockQuote(stock.ticker)
  const currentQuote = useMemo(
    () => resolveCurrentStockQuote(stock, history.points, quote.quote),
    [history.points, quote.quote, stock]
  )
  const varClass = getVariationClass(stock.varType)
  const severityClass = getVariationSeverityClass(stock.var, stock.varType)
  const primaryRows: StockDetailRow[] = [
    { label: 'Último precio', value: formatMoney(currentQuote.price) },
    {
      label: 'Variación diaria',
      value: formatSignedPercent(currentQuote.variation),
      valueClassName: `stock-var ${varClass} ${severityClass}`.trim(),
    },
    {
      label: 'Apertura',
      value: formatMoney(currentQuote.open),
      className: 'stock-details-market-cell',
    },
    {
      label: 'Cierre anterior',
      value: formatMoney(currentQuote.previousClose),
      className: 'stock-details-market-cell',
    },
    {
      label: 'Volumen nominal',
      value: formatInteger(currentQuote.volume),
      className: 'stock-details-market-cell',
    },
  ]
  const secondaryRows: StockDetailRow[] = [
    {
      label: 'Cantidad compra',
      value: formatInteger(stock.buyQty),
      className: 'stock-details-quote-cell',
    },
    {
      label: 'Precio compra',
      value: formatMoney(stock.buyPrice),
      className: 'stock-details-quote-cell',
    },
    {
      label: 'Precio venta',
      value: formatMoney(stock.sellPrice),
      className: 'stock-details-quote-cell',
    },
    {
      label: 'Cantidad venta',
      value: formatInteger(stock.sellQty),
      className: 'stock-details-quote-cell',
    },
    { label: 'Mínimo', value: formatMoney(stock.min) },
    { label: 'Máximo', value: formatMoney(stock.max) },
  ]

  return (
    <div className="stock-details-content stock-details-content-modal">
      <StockDetailsMetricGrid
        rows={primaryRows}
        gridClassName="stock-details-grid stock-details-grid-primary"
      />
      <HistorySection
        stock={stock}
        variant="modal"
        historyRange={historyRange}
        onHistoryRangeChange={setHistoryRange}
        history={history}
        quoteDetail={quote.quote}
        quoteSource={quote.source ?? history.meta?.source ?? null}
      />
      <StockDetailsMetricGrid
        rows={secondaryRows}
        gridClassName="stock-details-grid stock-details-grid-secondary"
      />
    </div>
  )
}

export default function StockDetailsContent(props: StockDetailsContentProps) {
  if (props.variant === 'page') {
    return (
      <div className="stock-details-content stock-details-content-page">
        <HistorySection
          stock={props.stock}
          variant="page"
          historyRange={props.historyRange}
          onHistoryRangeChange={props.onHistoryRangeChange}
          history={props.history}
          quoteDetail={props.quoteDetail}
          quoteSource={props.quoteSource}
        />
      </div>
    )
  }

  return <StockDetailsModalContent stock={props.stock} />
}
