import type { Variation } from '@pulse-fx/shared';
import { formatPercent, variationDirection } from '../lib/format.js';

interface Props {
  variation: Variation | null;
  /** Texto que explica o denominador; vira o tooltip acessivel. */
  description: string;
  size?: 'sm' | 'lg';
}

const DIRECTION_STYLE = {
  up: 'text-up bg-up/10 border-up/30',
  down: 'text-down bg-down/10 border-down/30',
  flat: 'text-flat bg-flat/10 border-flat/30',
} as const;

/**
 * Sinal de alta/baixa.
 *
 * Acessibilidade: a cor NUNCA e o unico indicador. Ha seta e sinal
 * aritmetico, entao a leitura funciona em daltonismo e em impressao
 * monocromatica.
 */
export function VariationBadge({ variation, description, size = 'sm' }: Props): JSX.Element {
  const direction = variationDirection(variation);
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—';

  if (!variation) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${DIRECTION_STYLE.flat}`}
        title={description}
      >
        <span aria-hidden="true">—</span>
        <span className="text-xs">sem dado</span>
      </span>
    );
  }

  const label = formatPercent(variation.percent);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-medium ${
        DIRECTION_STYLE[direction]
      } ${size === 'lg' ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-sm'}`}
      title={description}
      aria-label={`Variacao ${label}. ${description}`}
    >
      <span aria-hidden="true">{arrow}</span>
      {label}
    </span>
  );
}
