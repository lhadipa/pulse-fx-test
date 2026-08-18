import { addDays, subtractYears } from '../domain/date.js';
import { IndicatorNotFoundError } from '../domain/errors.js';
import type { Indicator, IndicatorFrequency, Observation } from '../domain/types.js';
import type { Clock, IndicatorRepository, ObservationRepository } from './ports.js';

export type HistoryWindow = '30d' | '90d' | '1y' | '5y' | 'max';

/**
 * Janela de historico por TIPO DE SERIE (briefing, secao 4.2).
 *
 * O default difere por frequencia porque a mesma janela nao serve para as
 * duas: 90 dias de uma serie mensal sao tres pontos - um grafico inutil.
 */
export const DEFAULT_WINDOW: Record<IndicatorFrequency, HistoryWindow> = {
  DAILY: '90d',
  MONTHLY: '5y',
};

/** Janelas oferecidas na UI para cada frequencia. */
export const AVAILABLE_WINDOWS: Record<IndicatorFrequency, HistoryWindow[]> = {
  DAILY: ['30d', '90d', '1y', '5y'],
  MONTHLY: ['1y', '5y', 'max'],
};

export interface SeriesResult {
  indicator: Indicator;
  window: HistoryWindow;
  from: string | null;
  to: string;
  observations: Observation[];
}

export class GetSeriesUseCase {
  constructor(
    private readonly indicators: IndicatorRepository,
    private readonly observations: ObservationRepository,
    private readonly clock: Clock,
  ) {}

  /** Converte a janela em data inicial. `null` significa "sem limite". */
  private resolveFrom(window: HistoryWindow, today: string): string | null {
    switch (window) {
      case '30d':
        return addDays(today, -30);
      case '90d':
        return addDays(today, -90);
      case '1y':
        return subtractYears(today, 1);
      case '5y':
        return subtractYears(today, 5);
      case 'max':
        return null;
    }
  }

  async execute(code: string, requestedWindow?: HistoryWindow): Promise<SeriesResult> {
    const indicator = await this.indicators.findByCode(code);
    if (!indicator || !indicator.active) throw new IndicatorNotFoundError(code);

    const window = requestedWindow ?? DEFAULT_WINDOW[indicator.frequency];
    const today = this.clock.today();
    const from = this.resolveFrom(window, today);

    // O limite superior e hoje: observacoes com data futura (a meta Selic
    // publica algumas) nao entram no grafico, pelo mesmo motivo que nao
    // entram no calculo de variacao.
    const observations = await this.observations.findRange(indicator.id, from, today);

    return { indicator, window, from, to: today, observations };
  }
}
