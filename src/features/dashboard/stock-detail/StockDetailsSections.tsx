'use client'

import { type ReactNode } from 'react'
import AdvancedStockDetailChart from '@/features/dashboard/charts/AdvancedStockDetailChart'
import LightweightStockChart from '@/features/dashboard/charts/LightweightStockChart'
import { type StockData } from '@/features/dashboard/shared/stockData'
import {
  formatCurrencyARS,
  formatPercentage,
  formatQuantity,
  normalizeCurrency,
} from '@/lib/formatters'
import {
  STOCK_HISTORY_RANGES,
  type StockHistoryPoint,
  type StockHistoryRange,
  type StockHistoryResponseMeta,
} from '@/lib/stockHistory'
import { type StockPeriodMetrics } from '@/features/dashboard/charts/advancedStockChart'
import { type ResolvedCurrentQuote } from '@/features/dashboard/stock-detail/currentStockQuote'
import { type StockQuoteDepthLevel } from '@/lib/stockQuote'

export type HistoryViewState = {
  points: StockHistoryPoint[]
  meta?: StockHistoryResponseMeta
  error?: Error
  isLoading: boolean
  isRefreshing: boolean
  viewStatus: 'loading' | 'error' | 'empty' | 'success'
}

export type StockDetailRow = {
  label: string
  value: string
  className?: string
  valueClassName?: string
}

const HISTORY_RANGE_LABEL: Record<StockHistoryRange, string> = {
  '1W': 'Última semana',
  '1M': 'Último mes',
  '3M': 'Últimos 3 meses',
  '6M': 'Últimos 6 meses',
  '1Y': 'Último año',
  '3Y': 'Últimos 3 años',
  '5Y': 'Últimos 5 años',
}

export function HistoryRangeControls({
  range,
  onChange,
}: {
  range: StockHistoryRange
  onChange: (range: StockHistoryRange) => void
}) {
  return (
    <div className="stock-history-range-control">
      <span className="stock-history-control-label">Período</span>
      <div className="stock-history-range-group" aria-label="Período">
        {STOCK_HISTORY_RANGES.map((option) => (
          <button
            key={option}
            type="button"
            className={
              option === range
                ? 'stock-history-range-button stock-history-range-button-active'
                : 'stock-history-range-button'
            }
            onClick={() => onChange(option)}
            aria-pressed={option === range}
            title={HISTORY_RANGE_LABEL[option]}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

export function StockDetailsMetricGrid({
  rows,
  gridClassName,
}: {
  rows: StockDetailRow[]
  gridClassName: string
}) {
  return (
    <dl className={gridClassName}>
      {rows.map(({ label, value, className, valueClassName }) => (
        <div
          key={label}
          className={`stock-details-metric-card ${className ?? ''}`.trim()}
        >
          <dt className="stock-details-metric-label">{label}</dt>
          <dd
            className={`stock-details-metric-value ${
              valueClassName ?? ''
            }`.trim()}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function HistorySectionHeader({
  historyRange,
  periodVariation,
  periodVariationClass,
  metaMessage,
  metaInformational = false,
  refreshMessage,
  controls,
}: {
  historyRange: StockHistoryRange
  periodVariation: number | null
  periodVariationClass: string
  metaMessage: string | null
  metaInformational?: boolean
  refreshMessage: string | null
  controls: ReactNode
}) {
  return (
    <div className="stock-history-header">
      <div className="stock-history-heading">
        <h2 id="stock-history-title" className="stock-history-title">
          Histórico
        </h2>
        <p className="stock-history-subtitle">
          {HISTORY_RANGE_LABEL[historyRange]}:{' '}
          {periodVariation !== null ? (
            <span className={`stock-history-performance ${periodVariationClass}`}>
              {formatPercentage(periodVariation)}
            </span>
          ) : (
            <span className="stock-history-performance stock-history-performance-neutral">
              —
            </span>
          )}
        </p>
        {metaMessage && (
          <p className={`stock-history-subtitle stock-history-subtitle-meta${metaInformational ? ' stock-history-subtitle-info' : ''}`}>
            {metaMessage}
          </p>
        )}
        {refreshMessage && (
          <p className="stock-history-subtitle stock-history-subtitle-meta">
            {refreshMessage}
          </p>
        )}
      </div>

      {controls}
    </div>
  )
}

export function HistoryStateContent({ history }: { history: HistoryViewState }) {
  if (history.isLoading) {
    return (
      <div className="stock-history-state stock-history-state-loading" role="status">
        <span className="stock-history-skeleton" aria-hidden="true" />
        Cargando histórico...
      </div>
    )
  }

  if (history.viewStatus === 'error') {
    return (
      <div className="stock-history-state stock-history-state-error" role="alert">
        {history.error?.message ?? 'No se pudo cargar el histórico.'}
      </div>
    )
  }

  if (history.viewStatus === 'empty') {
    return (
      <div className="stock-history-state">
        <strong>Sin histórico disponible</strong>
        <span>No hay datos históricos para este rango.</span>
      </div>
    )
  }

  return null
}

export function HistoryChartSection({
  stock,
  variant,
  history,
  chartSeries,
  rangeControls,
}: {
  stock: StockData
  variant: 'modal' | 'page'
  history: HistoryViewState
  chartSeries: StockHistoryPoint[]
  rangeControls: ReactNode
}) {
  if (history.viewStatus !== 'success') {
    return null
  }

  return (
    <div
      className={
        history.isRefreshing
          ? 'stock-history-chart-wrap stock-history-chart-wrap-refreshing'
          : 'stock-history-chart-wrap'
      }
    >
      {variant === 'page' ? (
        <AdvancedStockDetailChart
          points={chartSeries}
          symbol={stock.ticker}
          rangeControls={rangeControls}
        />
      ) : (
        <LightweightStockChart points={chartSeries} symbol={stock.ticker} />
      )}
    </div>
  )
}

function PeriodSummarySection({
  currentQuote,
  periodMetrics,
  periodVariation,
  periodVariationClass,
}: {
  currentQuote: ResolvedCurrentQuote
  periodMetrics: StockPeriodMetrics | null
  periodVariation: number | null
  periodVariationClass: string
}) {
  return (
    <section
      className="stock-detail-data-section"
      aria-labelledby="stock-detail-period-title"
    >
      <div className="stock-detail-section-header">
        <h2 id="stock-detail-period-title" className="stock-detail-section-title">
          Resumen del período
        </h2>
      </div>
      <dl className="stock-detail-period-metrics">
        <div className="stock-detail-period-metric">
          <dt>Precio actual</dt>
          <dd>
            {formatCurrencyARS(currentQuote.price, {
              zeroIsMissing: true,
            })}
          </dd>
        </div>
        <div className="stock-detail-period-metric">
          <dt>Variación del período</dt>
          <dd className={periodVariationClass}>
            {formatPercentage(periodVariation)}
          </dd>
        </div>
        <div className="stock-detail-period-metric">
          <dt>Máximo del período</dt>
          <dd>
            {formatCurrencyARS(periodMetrics?.periodHigh, {
              zeroIsMissing: true,
            })}
          </dd>
        </div>
        <div className="stock-detail-period-metric">
          <dt>Mínimo del período</dt>
          <dd>
            {formatCurrencyARS(periodMetrics?.periodLow, {
              zeroIsMissing: true,
            })}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function DailyQuoteSection({
  currentQuote,
  historyDataStatus,
}: {
  currentQuote: ResolvedCurrentQuote
  historyDataStatus: string | null
}) {
  return (
    <section
      className="stock-detail-data-section"
      aria-labelledby="stock-detail-daily-title"
    >
      <div className="stock-detail-section-header">
        <h2 id="stock-detail-daily-title" className="stock-detail-section-title">
          Cotización diaria
        </h2>
        {historyDataStatus && <span>{historyDataStatus}</span>}
      </div>
      <dl className="stock-detail-secondary-grid">
        <div className="stock-detail-secondary-metric">
          <dt>Apertura</dt>
          <dd>{formatCurrencyARS(currentQuote.open, { zeroIsMissing: true })}</dd>
        </div>
        <div className="stock-detail-secondary-metric">
          <dt>Cierre anterior</dt>
          <dd>
            {formatCurrencyARS(currentQuote.previousClose, {
              zeroIsMissing: true,
            })}
          </dd>
        </div>
        <div className="stock-detail-secondary-metric">
          <dt>Mínimo diario</dt>
          <dd>{formatCurrencyARS(currentQuote.low, { zeroIsMissing: true })}</dd>
        </div>
        <div className="stock-detail-secondary-metric">
          <dt>Máximo diario</dt>
          <dd>{formatCurrencyARS(currentQuote.high, { zeroIsMissing: true })}</dd>
        </div>
      </dl>
    </section>
  )
}

function LiquiditySection({
  currentQuote,
}: {
  currentQuote: ResolvedCurrentQuote
}) {
  return (
    <section
      className="stock-detail-data-section"
      aria-labelledby="stock-detail-liquidity-title"
    >
      <div className="stock-detail-section-header">
        <h2
          id="stock-detail-liquidity-title"
          className="stock-detail-section-title"
        >
          Liquidez
        </h2>
      </div>
      <dl className="stock-detail-secondary-grid">
        <div className="stock-detail-secondary-metric">
          <dt>Volumen nominal</dt>
          <dd>{formatQuantity(currentQuote.volume)}</dd>
        </div>
        <div className="stock-detail-secondary-metric">
          <dt>Monto operado</dt>
          <dd>{formatCurrencyARS(currentQuote.amountTraded)}</dd>
        </div>
        <div className="stock-detail-secondary-metric">
          <dt>Moneda</dt>
          <dd>{normalizeCurrency(currentQuote.currency)}</dd>
        </div>
        <div className="stock-detail-secondary-metric">
          <dt>Cantidad de operaciones</dt>
          <dd>{formatQuantity(currentQuote.operationCount)}</dd>
        </div>
      </dl>
    </section>
  )
}

function MarketDepthSection({ depth }: { depth: StockQuoteDepthLevel[] }) {
  return (
    <section
      className="stock-detail-data-section stock-detail-market-depth"
      aria-labelledby="stock-detail-market-depth-title"
    >
      <div className="stock-detail-section-header">
        <h2
          id="stock-detail-market-depth-title"
          className="stock-detail-section-title"
        >
          Puntas
        </h2>
      </div>
      {depth.length === 0 ? (
        <p className="stock-detail-market-depth-empty">
          Sin puntas disponibles
        </p>
      ) : (
        <>
          <div className="stock-detail-market-depth-table-wrap">
            <table className="stock-detail-market-depth-table">
              <thead>
                <tr>
                  <th scope="col">Cant. compra</th>
                  <th scope="col">Precio compra</th>
                  <th scope="col">Precio venta</th>
                  <th scope="col">Cant. venta</th>
                </tr>
              </thead>
              <tbody>
                {depth.map((level, index) => (
                  <tr key={index}>
                    <td>{formatQuantity(level.buyQuantity)}</td>
                    <td className="stock-detail-market-depth-buy">
                      {formatCurrencyARS(level.buyPrice, {
                        zeroIsMissing: true,
                      })}
                    </td>
                    <td className="stock-detail-market-depth-sell">
                      {formatCurrencyARS(level.sellPrice, {
                        zeroIsMissing: true,
                      })}
                    </td>
                    <td>{formatQuantity(level.sellQuantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="stock-detail-market-depth-mobile"
            aria-label="Puntas por nivel"
          >
            {depth.map((level, index) => (
              <div className="stock-detail-market-depth-card" key={index}>
                <div className="stock-detail-market-depth-side">
                  <span className="stock-detail-market-depth-side-title">
                    Compra
                  </span>
                  <span
                    className="stock-detail-market-depth-price stock-detail-market-depth-buy"
                    aria-label={`Precio compra: ${formatCurrencyARS(
                      level.buyPrice,
                      {
                        zeroIsMissing: true,
                      }
                    )}`}
                  >
                    {formatCurrencyARS(level.buyPrice, {
                      zeroIsMissing: true,
                    })}
                  </span>
                  <span
                    className="stock-detail-market-depth-quantity"
                    aria-label={`Cantidad compra: ${formatQuantity(
                      level.buyQuantity
                    )}`}
                  >
                    Cantidad: {formatQuantity(level.buyQuantity)}
                  </span>
                </div>
                <div className="stock-detail-market-depth-side">
                  <span className="stock-detail-market-depth-side-title">
                    Venta
                  </span>
                  <span
                    className="stock-detail-market-depth-price stock-detail-market-depth-sell"
                    aria-label={`Precio venta: ${formatCurrencyARS(
                      level.sellPrice,
                      {
                        zeroIsMissing: true,
                      }
                    )}`}
                  >
                    {formatCurrencyARS(level.sellPrice, {
                      zeroIsMissing: true,
                    })}
                  </span>
                  <span
                    className="stock-detail-market-depth-quantity"
                    aria-label={`Cantidad venta: ${formatQuantity(
                      level.sellQuantity
                    )}`}
                  >
                    Cantidad: {formatQuantity(level.sellQuantity)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export function PageDetailDataSections({
  currentQuote,
  periodMetrics,
  periodVariation,
  periodVariationClass,
  historyDataStatus,
}: {
  currentQuote: ResolvedCurrentQuote
  periodMetrics: StockPeriodMetrics | null
  periodVariation: number | null
  periodVariationClass: string
  historyDataStatus: string | null
}) {
  return (
    <>
      <PeriodSummarySection
        currentQuote={currentQuote}
        periodMetrics={periodMetrics}
        periodVariation={periodVariation}
        periodVariationClass={periodVariationClass}
      />
      <DailyQuoteSection
        currentQuote={currentQuote}
        historyDataStatus={historyDataStatus}
      />
      <LiquiditySection currentQuote={currentQuote} />
      <MarketDepthSection depth={currentQuote.depth} />
    </>
  )
}
