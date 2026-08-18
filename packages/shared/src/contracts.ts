import { z } from 'zod';

/**
 * Contrato HTTP compartilhado entre API e Web.
 *
 * Um unico schema define a forma dos dados nas duas pontas: a API valida a
 * resposta contra ele em testes e o cliente web deriva os tipos daqui. Isso
 * elimina o drift silencioso entre backend e frontend.
 */

export const INDICATOR_FREQUENCIES = ['DAILY', 'MONTHLY'] as const;
export const indicatorFrequencySchema = z.enum(INDICATOR_FREQUENCIES);
export type IndicatorFrequency = z.infer<typeof indicatorFrequencySchema>;

export const INDICATOR_SOURCES = ['BCB_SGS', 'BCB_PTAX', 'FRED'] as const;
export const indicatorSourceSchema = z.enum(INDICATOR_SOURCES);
export type IndicatorSource = z.infer<typeof indicatorSourceSchema>;

/**
 * Unidade do valor da serie. Determina como o frontend formata o numero e
 * qual leitura de variacao faz sentido (uma taxa de juros varia em pontos
 * percentuais, um cambio varia em percentual).
 */
export const INDICATOR_UNITS = ['BRL', 'PERCENT', 'PERCENT_PER_YEAR', 'INDEX'] as const;
export const indicatorUnitSchema = z.enum(INDICATOR_UNITS);
export type IndicatorUnit = z.infer<typeof indicatorUnitSchema>;

/** Janelas de historico suportadas na tela de detalhe. */
export const HISTORY_WINDOWS = ['30d', '90d', '1y', '5y', 'max'] as const;
export const historyWindowSchema = z.enum(HISTORY_WINDOWS);
export type HistoryWindow = z.infer<typeof historyWindowSchema>;

/** Data de referencia no formato ISO (YYYY-MM-DD), sem hora e sem timezone. */
export const refDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'refDate deve ser YYYY-MM-DD');

/**
 * Valores numericos trafegam como string.
 *
 * Precisao financeira nao sobrevive a um double de JSON: 0.1 + 0.2 !== 0.3.
 * O banco guarda NUMERIC, o dominio usa Decimal e a serializacao mantem string
 * ate o ultimo momento, quando o frontend formata para exibicao.
 */
export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'valor decimal invalido');

export const observationSchema = z.object({
  refDate: refDateSchema,
  value: decimalStringSchema,
});
export type Observation = z.infer<typeof observationSchema>;

export const variationSchema = z.object({
  /** Diferenca absoluta entre latest e previous, na unidade da serie. */
  absolute: decimalStringSchema,
  /** Variacao percentual. `null` quando o denominador e zero. */
  percent: decimalStringSchema.nullable(),
  /** N do briefing secao 5: quantas observacoes disponiveis para tras. */
  lag: z.number().int().positive(),
  /** Rotulo da unidade do lag, para a UI explicar o denominador. */
  lagUnit: z.enum(['business_day', 'month']),
});
export type Variation = z.infer<typeof variationSchema>;

export const indicatorSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  shortName: z.string(),
  source: indicatorSourceSchema,
  unit: indicatorUnitSchema,
  frequency: indicatorFrequencySchema,
  precision: z.number().int().min(0).max(8),
  /** Ultima observacao valida persistida. `null` quando a serie ainda nao sincronizou. */
  latest: observationSchema.nullable(),
  /** Denominador explicito da variacao, exigido pelo briefing secao 5. */
  previous: observationSchema.nullable(),
  variation: variationSchema.nullable(),
  isFavorite: z.boolean(),
  /** Quando a serie foi sincronizada com sucesso pela ultima vez. */
  lastSyncedAt: z.string().datetime().nullable(),
});
export type IndicatorSummary = z.infer<typeof indicatorSummarySchema>;

export const indicatorDetailSchema = indicatorSummarySchema.extend({
  /** Justificativa editorial da serie (briefing secao 3: 2-5 linhas). */
  rationale: z.string(),
  /** Limitacoes dos dados exibidas na tela de detalhe (briefing secao 4.2). */
  limitations: z.string(),
  sourceUrl: z.string().url(),
  defaultWindow: historyWindowSchema,
});
export type IndicatorDetail = z.infer<typeof indicatorDetailSchema>;

export const seriesResponseSchema = z.object({
  code: z.string(),
  window: historyWindowSchema,
  from: refDateSchema.nullable(),
  to: refDateSchema.nullable(),
  count: z.number().int().nonnegative(),
  observations: z.array(observationSchema),
});
export type SeriesResponse = z.infer<typeof seriesResponseSchema>;

export const indicatorListResponseSchema = z.object({
  indicators: z.array(indicatorSummarySchema),
});
export type IndicatorListResponse = z.infer<typeof indicatorListResponseSchema>;

export const favoritesResponseSchema = z.object({
  codes: z.array(z.string()),
});
export type FavoritesResponse = z.infer<typeof favoritesResponseSchema>;

export const syncResultSchema = z.object({
  code: z.string(),
  status: z.enum(['success', 'failed', 'skipped_ttl']),
  rowsUpserted: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;

export const syncResponseSchema = z.object({
  results: z.array(syncResultSchema),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Header usado para identificar o cliente anonimo dono dos favoritos. */
export const CLIENT_ID_HEADER = 'x-client-id';
