import { calculateVariation, latestObservation, policyFor } from '../domain/variation.js';
import { IndicatorNotFoundError } from '../domain/errors.js';
import type { Indicator, Observation, Variation } from '../domain/types.js';
import type {
  Clock,
  FavoriteRepository,
  IndicatorRepository,
  ObservationRepository,
  SyncRunRepository,
} from './ports.js';

/**
 * Monta a visao de um indicador para a UI.
 *
 * Este caso de uso e a UNICA porta de entrada para "ultimo valor + variacao",
 * usada tanto pelo dashboard quanto pela tela de detalhe. E assim que o
 * requisito de consistencia entre as duas telas (briefing, secao 5) e
 * garantido por construcao: nao existe um segundo lugar onde a conta possa
 * ser feita de forma diferente.
 */

export interface IndicatorView {
  indicator: Indicator;
  latest: Observation | null;
  variation: Variation | null;
  isFavorite: boolean;
  lastSyncedAt: Date | null;
}

/**
 * Quantas observacoes carregar por indicador para calcular a variacao.
 *
 * Precisamos de lag+1 no caso feliz, mas series diarias tem buracos (feriado,
 * falha de publicacao). Uma folga pequena cobre esses buracos sem carregar a
 * serie inteira - que e justamente o que o indice (indicator_id, ref_date DESC)
 * evita.
 */
const LOOKBACK_SLACK = 10;

export class ListIndicatorsUseCase {
  constructor(
    private readonly indicators: IndicatorRepository,
    private readonly observations: ObservationRepository,
    private readonly favorites: FavoriteRepository,
    private readonly syncRuns: SyncRunRepository,
    private readonly clock: Clock,
  ) {}

  private async buildView(
    indicator: Indicator,
    favoriteCodes: Set<string>,
    lastSyncByIndicator: Map<number, Date>,
  ): Promise<IndicatorView> {
    const policy = policyFor(indicator.frequency, indicator.variationLag);
    const recent = await this.observations.findRecent(
      indicator.id,
      policy.lag + 1 + LOOKBACK_SLACK,
    );
    const today = this.clock.today();

    return {
      indicator,
      latest: latestObservation(recent, today),
      variation: calculateVariation(recent, policy, today),
      isFavorite: favoriteCodes.has(indicator.code),
      lastSyncedAt: lastSyncByIndicator.get(indicator.id) ?? null,
    };
  }

  async execute(options: {
    clientId: string | null;
    onlyFavorites?: boolean;
  }): Promise<IndicatorView[]> {
    const [all, favoriteCodes, lastSyncByIndicator] = await Promise.all([
      this.indicators.findAllActive(),
      options.clientId ? this.favorites.findCodesByClient(options.clientId) : Promise.resolve([]),
      this.syncRuns.findLastSuccessAtByIndicator(),
    ]);

    const favorites = new Set(favoriteCodes);
    const selected = options.onlyFavorites ? all.filter((i) => favorites.has(i.code)) : all;

    return Promise.all(selected.map((i) => this.buildView(i, favorites, lastSyncByIndicator)));
  }

  async executeOne(code: string, clientId: string | null): Promise<IndicatorView> {
    const indicator = await this.indicators.findByCode(code);
    if (!indicator || !indicator.active) throw new IndicatorNotFoundError(code);

    const [favoriteCodes, lastSyncByIndicator] = await Promise.all([
      clientId ? this.favorites.findCodesByClient(clientId) : Promise.resolve([]),
      this.syncRuns.findLastSuccessAtByIndicator(),
    ]);

    return this.buildView(indicator, new Set(favoriteCodes), lastSyncByIndicator);
  }
}
