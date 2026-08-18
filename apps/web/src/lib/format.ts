import type { IndicatorSummary, IndicatorUnit, Variation } from '@pulse-fx/shared';

/**
 * Formatacao para exibicao.
 *
 * Os valores chegam da API como STRING para preservar precisao. A conversao
 * para numero acontece so aqui, na ultima milha, exclusivamente para
 * formatar - nenhuma conta de negocio e refeita no frontend.
 */

const ptBR = 'pt-BR';

export function formatValue(value: string, unit: IndicatorUnit, precision: number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';

  const formatted = numeric.toLocaleString(ptBR, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  switch (unit) {
    case 'BRL':
      return `R$ ${formatted}`;
    case 'PERCENT':
    case 'PERCENT_PER_YEAR':
      return `${formatted}%`;
    case 'INDEX':
      return formatted;
  }
}

/** "2026-08-12" -> "12/08/2026", sem passar por Date (evita shift de fuso). */
export function formatRefDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

export function formatPercent(percent: string | null): string {
  if (percent === null) return '--';

  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) return '--';

  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toLocaleString(ptBR, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export type VariationDirection = 'up' | 'down' | 'flat';

export function variationDirection(variation: Variation | null): VariationDirection {
  if (!variation) return 'flat';

  const reference = variation.percent ?? variation.absolute;
  const numeric = Number(reference);

  if (!Number.isFinite(numeric) || numeric === 0) return 'flat';
  return numeric > 0 ? 'up' : 'down';
}

/**
 * Texto que torna o denominador da variacao EXPLICITO para o usuario, como
 * exige a secao 5 do briefing. Sem isto, "+0,69%" nao diz contra o que.
 */
export function describeVariation(indicator: IndicatorSummary): string {
  if (!indicator.variation || !indicator.previous) {
    return 'Sem dado anterior suficiente para calcular a variacao.';
  }

  const unitLabel = indicator.variation.lagUnit === 'month' ? 'mes' : 'fechamento';
  const previousValue = formatValue(
    indicator.previous.value,
    indicator.unit,
    indicator.precision,
  );

  return `Comparado com o ${unitLabel} anterior: ${previousValue} em ${formatRefDate(
    indicator.previous.refDate,
  )}.`;
}

/** "ha 20 min" / "ha 3 h". Usado no rodape do card, nunca como data do dado. */
export function formatRelativeTime(isoDateTime: string | null, now: Date = new Date()): string {
  if (!isoDateTime) return 'nunca sincronizado';

  const elapsedMinutes = Math.floor((now.getTime() - new Date(isoDateTime).getTime()) / 60_000);

  if (elapsedMinutes < 1) return 'agora mesmo';
  if (elapsedMinutes < 60) return `ha ${elapsedMinutes} min`;

  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `ha ${hours} h`;

  const days = Math.floor(hours / 24);
  return `ha ${days} d`;
}
