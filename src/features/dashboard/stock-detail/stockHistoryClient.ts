import {
  isStockHistoryErrorCode,
  isStockHistoryMarket,
  isStockHistoryPoint,
  isStockHistoryRange,
  isValidStockHistoryCacheState,
  type StockHistoryErrorCode,
  type StockHistoryResponse,
  type StockHistorySuccessResponse,
} from '@/lib/stockHistory'
import {
  fetchValidatedJson,
  isJsonRecord,
  responseUrlSuffix,
} from '@/features/dashboard/shared/fetchJsonClient'

type StockHistoryErrorResponse = Extract<StockHistoryResponse, { ok: false }>

function isStockHistoryErrorResponse(
  value: unknown
): value is StockHistoryErrorResponse {
  return (
    isJsonRecord(value) &&
    value.ok === false &&
    isStockHistoryErrorCode(value.error)
  )
}

function assertStockHistorySuccessResponse(
  value: unknown
): asserts value is StockHistorySuccessResponse {
  if (!isJsonRecord(value) || value.ok !== true) {
    throw new Error('Respuesta inválida del servidor: contrato de históricos inválido.')
  }

  const historyData = value.data

  if (!Array.isArray(historyData) || !historyData.every(isStockHistoryPoint)) {
    throw new Error('Respuesta inválida del servidor: históricos inválidos.')
  }

  if (
    historyData.some(
      (point, index) => index > 0 && point.date <= historyData[index - 1].date
    )
  ) {
    throw new Error(
      'Respuesta inválida del servidor: históricos deben tener fechas únicas y ascendentes.'
    )
  }

  if (
    typeof value.fetchedAt !== 'string' ||
    typeof value.servedAt !== 'string' ||
    !isStockHistoryRange(typeof value.range === 'string' ? value.range : null) ||
    !isStockHistoryMarket(typeof value.market === 'string' ? value.market : null) ||
    typeof value.symbol !== 'string'
  ) {
    throw new Error('Respuesta inválida del servidor: metadata histórica inválida.')
  }

  if (
    !isJsonRecord(value.meta) ||
    typeof value.meta.discardedPoints !== 'number' ||
    !Number.isInteger(value.meta.discardedPoints) ||
    value.meta.discardedPoints < 0 ||
    typeof value.meta.totalPoints !== 'number' ||
    !Number.isInteger(value.meta.totalPoints) ||
    value.meta.totalPoints !== historyData.length ||
    typeof value.meta.stale !== 'boolean' ||
    (value.meta.source !== 'demo' && value.meta.source !== 'live') ||
    (value.meta.requestId !== undefined && typeof value.meta.requestId !== 'string')
  ) {
    throw new Error('Respuesta inválida del servidor: meta histórica inválida.')
  }
  if (!isValidStockHistoryCacheState(value.cacheStatus, value.meta.stale)) {
    throw new Error(
      'Respuesta inválida del servidor: estado de caché histórica inválido.'
    )
  }
}

const HISTORY_ERROR_MESSAGE: Record<StockHistoryErrorCode, string> = {
  HISTORY_ERROR: 'No se pudo cargar el histórico.',
  INVALID_SYMBOL: 'Símbolo inválido para cargar histórico.',
  INVALID_MARKET: 'Mercado inválido para cargar histórico.',
  INVALID_RANGE: 'Rango inválido para cargar histórico.',
  RATE_LIMITED: 'Demasiadas solicitudes. Esperá unos segundos e intentá nuevamente.',
  RATE_LIMIT_UNAVAILABLE:
    'El control de rate limit no está disponible temporalmente. Intentá nuevamente en unos segundos.',
  METHOD_NOT_ALLOWED: 'Método no permitido para cargar histórico.',
}

function historyErrorMessage(error: StockHistoryErrorCode): string {
  switch (error) {
    case 'HISTORY_ERROR':
    case 'INVALID_SYMBOL':
    case 'INVALID_MARKET':
    case 'INVALID_RANGE':
    case 'RATE_LIMITED':
    case 'RATE_LIMIT_UNAVAILABLE':
    case 'METHOD_NOT_ALLOWED':
      return HISTORY_ERROR_MESSAGE[error]
  }
}

export async function getStockHistoryFetchError(
  response: Response,
  parsedJson?: unknown
): Promise<Error> {
  let json: unknown = parsedJson

  if (json === undefined) {
    try {
      json = await response.json()
    } catch {
      return new Error(
        `Error del servidor (${response.status}) al cargar el histórico${responseUrlSuffix(response)}.`
      )
    }
  }

  if (!isStockHistoryErrorResponse(json)) {
    return new Error(
      `Error del servidor (${response.status}) al cargar el histórico${responseUrlSuffix(response)}.`
    )
  }

  const message = historyErrorMessage(json.error)

  if (process.env.NODE_ENV !== 'production' && json.details) {
    return new Error(`${message} Detalle: ${json.details}`)
  }

  return new Error(message)
}

export const fetchStockHistory = async (
  url: string,
  options: { signal?: AbortSignal } = {}
): Promise<StockHistorySuccessResponse> =>
  fetchValidatedJson(url, {
    assertSuccessResponse: assertStockHistorySuccessResponse,
    getError: getStockHistoryFetchError,
    invalidJsonMessage: `Respuesta inválida del servidor al cargar el histórico: ${url}`,
    parseBeforeHttpError: true,
    signal: options.signal,
  })
