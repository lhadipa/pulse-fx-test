/**
 * Tipos do dominio. Esta camada e pura: nao importa nada de infraestrutura,
 * nao faz I/O e nao conhece HTTP nem banco de dados.
 */
import type { Decimal } from 'decimal.js';

export type IndicatorSource = 'BCB_SGS' | 'BCB_PTAX' | 'FRED';
export type IndicatorFrequency = 'DAILY' | 'MONTHLY';
export type IndicatorUnit = 'BRL' | 'PERCENT' | 'PERCENT_PER_YEAR' | 'INDEX';

/**
 * Uma observacao de uma serie temporal.
 *
 * `refDate` e a DATA DE REFERENCIA do dado (o dia a que a observacao se
 * refere), nunca a hora em que consultamos a fonte. O briefing e explicito
 * sobre nao confundir os dois, e a confusao entre eles e a origem classica de
 * bug em dashboards financeiros.
 */
export interface Observation {
  /** Data de referencia no formato ISO YYYY-MM-DD. */
  refDate: string;
  value: Decimal;
}

/** Politica de calculo de variacao, derivada da frequencia do indicador. */
export interface VariationPolicy {
  /**
   * Quantas OBSERVACOES DISPONIVEIS para tras usar como denominador.
   * Nao sao dias de calendario: em serie diaria, o dado anterior a uma
   * segunda-feira e a sexta-feira, e nao o domingo (que nao existe).
   */
  lag: number;
  lagUnit: 'business_day' | 'month';
}

export interface Variation {
  latest: Observation;
  previous: Observation;
  /** latest - previous, na unidade da serie. */
  absolute: Decimal;
  /** Variacao percentual. `null` quando o denominador e zero. */
  percent: Decimal | null;
  lag: number;
  lagUnit: 'business_day' | 'month';
}

export interface Indicator {
  id: number;
  code: string;
  source: IndicatorSource;
  externalId: string;
  name: string;
  shortName: string;
  unit: IndicatorUnit;
  frequency: IndicatorFrequency;
  variationLag: number;
  precision: number;
  rationale: string;
  limitations: string;
  sourceUrl: string;
  backfillYears: number;
  active: boolean;
}
