import { Decimal } from 'decimal.js';
import { compareIsoDates, todayIso } from './date.js';
import type { Observation, Variation, VariationPolicy, IndicatorFrequency } from './types.js';

/**
 * Regra de negocio da variacao percentual (briefing, secao 5).
 *
 * Esta funcao e PURA e e a UNICA fonte da verdade sobre variacao no sistema.
 * O dashboard e a tela de detalhe consomem o mesmo resultado, o que satisfaz
 * o requisito de consistencia entre as duas telas por construcao - nao por
 * disciplina de quem escreve a UI.
 *
 * Definicoes adotadas:
 *
 *   ULTIMO VALOR    A observacao valida mais recente ja persistida. "Valida"
 *                   exclui valores nao numericos e, crucialmente, exclui
 *                   observacoes com data de referencia NO FUTURO (ver abaixo).
 *
 *   DATA DE REF.    A data da observacao exibida. Nunca a hora da consulta.
 *
 *   VARIACAO %      (ultimo - anterior) / |anterior| * 100, onde "anterior" e
 *                   a N-esima observacao DISPONIVEL para tras. O denominador
 *                   e devolvido junto com o resultado para que a UI possa
 *                   torna-lo explicito ao usuario.
 *
 * Por que excluir datas futuras: a serie 432 do SGS (meta Selic) publica a
 * meta vigente projetada ate a proxima reuniao do COPOM. Consultada em
 * 18/08/2026, ela devolve observacoes datadas de 15/09/2026 e 16/09/2026.
 * Um "ultimo valor" ingenuo pegaria uma data que ainda nao aconteceu e
 * calcularia variacao contra o futuro. O filtro vale para todas as series:
 * e barato e evita a classe inteira de erro.
 *
 * Lacunas de calendario (fim de semana, feriado, falha de publicacao):
 * politica de ULTIMO DADO CONHECIDO, SEM INTERPOLACAO. Uma observacao que
 * nao existe simplesmente nao entra na contagem do lag. Interpolar serie
 * financeira fabricaria um preco que nunca foi negociado.
 */

/** Politica por frequencia. Os valores de N estao justificados no README. */
export const VARIATION_POLICIES: Record<IndicatorFrequency, VariationPolicy> = {
  /**
   * Series diarias (cambio e juros diarios): comparacao com o fechamento
   * anterior disponivel. E a leitura padrao de mercado ("o dolar hoje contra
   * ontem") e a unica que nao inventa dado em feriado.
   */
  DAILY: { lag: 1, lagUnit: 'business_day' },
  /**
   * Series mensais (IPCA, Fed Funds): variacao mes contra mes.
   * Deliberadamente NAO usamos "acumulado em 12 meses" como a variacao do
   * card: e outra metrica, com outro significado. Misturar as duas quebraria
   * a comparabilidade entre cards do dashboard.
   */
  MONTHLY: { lag: 1, lagUnit: 'month' },
};

export function policyFor(frequency: IndicatorFrequency, lagOverride?: number): VariationPolicy {
  const base = VARIATION_POLICIES[frequency];
  return lagOverride && lagOverride > 0 ? { ...base, lag: lagOverride } : base;
}

/**
 * Filtra as observacoes utilizaveis e as ordena da mais recente para a mais
 * antiga. Descarta datas futuras e valores nao finitos.
 */
export function selectValidObservations(
  observations: readonly Observation[],
  today: string = todayIso(),
): Observation[] {
  return observations
    .filter((o) => o.value.isFinite() && compareIsoDates(o.refDate, today) <= 0)
    .slice()
    .sort((a, b) => compareIsoDates(b.refDate, a.refDate));
}

/** A observacao valida mais recente, ou `null` se a serie nao tiver dado. */
export function latestObservation(
  observations: readonly Observation[],
  today: string = todayIso(),
): Observation | null {
  return selectValidObservations(observations, today)[0] ?? null;
}

/**
 * Calcula a variacao. Devolve `null` quando nao ha dado suficiente - a UI
 * exibe "sem dado" nesse caso, e NUNCA um 0% enganoso.
 */
export function calculateVariation(
  observations: readonly Observation[],
  policy: VariationPolicy,
  today: string = todayIso(),
): Variation | null {
  const valid = selectValidObservations(observations, today);

  const latest = valid[0];
  const previous = valid[policy.lag];
  if (!latest || !previous) return null;

  const absolute = latest.value.minus(previous.value);

  // Denominador zero nao tem variacao percentual definida. Em vez de devolver
  // Infinity ou NaN (que vazariam para a UI como "Infinity%"), devolvemos a
  // variacao absoluta e percent nulo.
  const percent = previous.value.isZero()
    ? null
    : absolute.dividedBy(previous.value.abs()).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

  return {
    latest,
    previous,
    absolute: absolute.toDecimalPlaces(8, Decimal.ROUND_HALF_UP),
    percent,
    lag: policy.lag,
    lagUnit: policy.lagUnit,
  };
}
