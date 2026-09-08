import {
  isPanelTitulo,
  isPanelErrorCode,
  type PanelErrorCode,
  type PanelResponse as MarketPanelResponse,
} from '@/lib/panel';
import { isValidFreshnessContract } from '@/lib/freshness';
import {
  fetchValidatedJson,
  isJsonRecord,
  responseUrlSuffix,
} from '@/features/dashboard/shared/fetchJsonClient';

export type MarketPanelSuccessResponse = Extract<
  MarketPanelResponse,
  { ok: true }
>;

function getMarketPanelSuccessValidationError(value: unknown): string | null {
  if (!isJsonRecord(value) || value.ok !== true) {
    return 'Respuesta inválida del servidor: contrato de éxito inválido.';
  }

  if (!Array.isArray(value.data)) {
    return 'Respuesta inválida del servidor: data debe ser un array.';
  }

  if (!value.data.every(isPanelTitulo)) {
    return 'Respuesta inválida del servidor: item de panel inválido.';
  }

  return isValidFreshnessContract(value)
    ? null
    : 'Respuesta inválida del servidor: metadata inválida.';
}

export function assertMarketPanelSuccessResponse(
  value: unknown,
): asserts value is MarketPanelSuccessResponse {
  const validationError = getMarketPanelSuccessValidationError(value);

  if (validationError) {
    throw new Error(validationError);
  }
}

type MarketPanelErrorResponse = Extract<MarketPanelResponse, { ok: false }>;

function isMarketPanelErrorResponse(
  value: unknown,
): value is MarketPanelErrorResponse {
  return (
    isJsonRecord(value) &&
    (value as { ok?: unknown }).ok === false &&
    isPanelErrorCode((value as { error?: unknown }).error)
  );
}

const PANEL_ERROR_MESSAGE: Record<PanelErrorCode, string> = {
  PANEL_ERROR: 'No se pudo cargar el panel de mercado.',
  RATE_LIMITED: 'Demasiadas solicitudes. Esperá unos segundos e intentá nuevamente.',
  RATE_LIMIT_UNAVAILABLE:
    'El control de rate limit no está disponible temporalmente. Intentá nuevamente en unos segundos.',
  REFRESH_COOLDOWN: 'Actualización reciente. Esperá unos segundos e intentá nuevamente.',
  METHOD_NOT_ALLOWED: 'Método no permitido para cargar el panel.',
  INVALID_PANEL_TYPE: 'Panel de mercado inválido.',
};

export async function getMarketPanelFetchError(
  response: Response,
): Promise<Error> {
  let json: unknown;

  try {
    json = await response.json();
  } catch {
    return new Error(
      `Error del servidor (${response.status}) al cargar el panel${responseUrlSuffix(response)}.`,
    );
  }

  if (!isMarketPanelErrorResponse(json)) {
    return new Error(
      `Error del servidor (${response.status}) al cargar el panel${responseUrlSuffix(response)}.`,
    );
  }

  const message = PANEL_ERROR_MESSAGE[json.error];

  if (process.env.NODE_ENV !== 'production' && json.details) {
    return new Error(`${message} Detalle: ${json.details}`);
  }

  return new Error(message);
}

export const fetchMarketPanel = async (
  url: string,
): Promise<MarketPanelSuccessResponse> =>
  fetchValidatedJson(url, {
    assertSuccessResponse: assertMarketPanelSuccessResponse,
    getError: getMarketPanelFetchError,
    invalidJsonMessage: `Respuesta inválida del servidor al cargar el panel: ${url}`,
  });
