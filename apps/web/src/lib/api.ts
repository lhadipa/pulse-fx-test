import {
  CLIENT_ID_HEADER,
  favoritesResponseSchema,
  indicatorDetailSchema,
  indicatorListResponseSchema,
  seriesResponseSchema,
  type FavoritesResponse,
  type HistoryWindow,
  type IndicatorDetail,
  type IndicatorListResponse,
  type SeriesResponse,
} from '@pulse-fx/shared';
import { getClientId } from './client-id.js';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3333';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Cliente HTTP tipado.
 *
 * As respostas passam pelos MESMOS schemas zod que a API usa (pacote
 * `@pulse-fx/shared`). Se o backend mudar o contrato sem atualizar o
 * frontend, o erro aparece aqui, com mensagem clara, em vez de virar
 * `undefined` renderizado no meio da tela.
 */
async function request<T>(
  path: string,
  parse: (data: unknown) => T,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      [CLIENT_ID_HEADER]: getClientId(),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(
      error?.message ?? `Falha na requisicao (HTTP ${response.status}).`,
      response.status,
      error?.code ?? 'UNKNOWN',
    );
  }

  return parse(body);
}

export const api = {
  listIndicators: (onlyFavorites = false): Promise<IndicatorListResponse> =>
    request(
      `/api/indicators${onlyFavorites ? '?favorites=true' : ''}`,
      (data) => indicatorListResponseSchema.parse(data),
    ),

  getIndicator: (code: string): Promise<IndicatorDetail> =>
    request(`/api/indicators/${encodeURIComponent(code)}`, (data) =>
      indicatorDetailSchema.parse(data),
    ),

  getSeries: (code: string, window?: HistoryWindow): Promise<SeriesResponse> =>
    request(
      `/api/indicators/${encodeURIComponent(code)}/observations${window ? `?window=${window}` : ''}`,
      (data) => seriesResponseSchema.parse(data),
    ),

  listFavorites: (): Promise<FavoritesResponse> =>
    request('/api/favorites', (data) => favoritesResponseSchema.parse(data)),

  addFavorite: (code: string): Promise<void> =>
    request(`/api/favorites/${encodeURIComponent(code)}`, () => undefined, { method: 'PUT' }),

  removeFavorite: (code: string): Promise<void> =>
    request(`/api/favorites/${encodeURIComponent(code)}`, () => undefined, { method: 'DELETE' }),
};
