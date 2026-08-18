import { GetSeriesUseCase } from './application/get-series.usecase.js';
import { ListIndicatorsUseCase } from './application/list-indicators.usecase.js';
import { SyncIndicatorsUseCase, type SyncLogger } from './application/sync-indicators.usecase.js';
import { ToggleFavoriteUseCase } from './application/toggle-favorite.usecase.js';
import { systemClock, type Clock, type SeriesProvider } from './application/ports.js';
import type { AppConfig } from './infrastructure/config/env.js';
import { createPool, type DatabasePool } from './infrastructure/db/client.js';
import { PostgresFavoriteRepository } from './infrastructure/db/repositories/favorite.repository.js';
import { PostgresIndicatorRepository } from './infrastructure/db/repositories/indicator.repository.js';
import { PostgresObservationRepository } from './infrastructure/db/repositories/observation.repository.js';
import { PostgresSyncRunRepository } from './infrastructure/db/repositories/sync-run.repository.js';
import { BcbPtaxProvider } from './infrastructure/providers/bcb-ptax.provider.js';
import { BcbSgsProvider } from './infrastructure/providers/bcb-sgs.provider.js';
import { FredProvider } from './infrastructure/providers/fred.provider.js';
import { HttpClient } from './infrastructure/providers/http-client.js';
import type { Indicator } from './domain/types.js';

/**
 * Composition root.
 *
 * Este e o unico lugar do sistema onde implementacoes concretas encontram as
 * interfaces que os casos de uso consomem. Nenhum caso de uso instancia um
 * repositorio ou um provider - e o que torna possivel testa-los com dublês em
 * memoria, sem Postgres e sem rede.
 */
export interface AppContainer {
  config: AppConfig;
  pool: DatabasePool;
  listIndicators: ListIndicatorsUseCase;
  getSeries: GetSeriesUseCase;
  toggleFavorite: ToggleFavoriteUseCase;
  syncIndicators: SyncIndicatorsUseCase;
  close: () => Promise<void>;
}

export function buildProviders(config: AppConfig): Map<Indicator['source'], SeriesProvider> {
  const httpOptions = {
    timeoutMs: config.HTTP_TIMEOUT_MS,
    maxRetries: config.HTTP_MAX_RETRIES,
  };

  const sgs = new BcbSgsProvider(new HttpClient('BCB_SGS', httpOptions));
  const ptax = new BcbPtaxProvider(new HttpClient('BCB_PTAX', httpOptions));
  const fred = new FredProvider(new HttpClient('FRED', httpOptions), config.FRED_API_KEY);

  return new Map<Indicator['source'], SeriesProvider>([
    ['BCB_SGS', sgs],
    ['BCB_PTAX', ptax],
    ['FRED', fred],
  ]);
}

export function createContainer(
  config: AppConfig,
  options: { clock?: Clock; syncLogger?: SyncLogger; pool?: DatabasePool } = {},
): AppContainer {
  const pool = options.pool ?? createPool(config.DATABASE_URL);
  const clock = options.clock ?? systemClock;

  const indicators = new PostgresIndicatorRepository(pool);
  const observations = new PostgresObservationRepository(pool);
  const syncRuns = new PostgresSyncRunRepository(pool);
  const favorites = new PostgresFavoriteRepository(pool);

  return {
    config,
    pool,
    listIndicators: new ListIndicatorsUseCase(indicators, observations, favorites, syncRuns, clock),
    getSeries: new GetSeriesUseCase(indicators, observations, clock),
    toggleFavorite: new ToggleFavoriteUseCase(indicators, favorites),
    syncIndicators: new SyncIndicatorsUseCase(
      indicators,
      observations,
      syncRuns,
      buildProviders(config),
      clock,
      config.SYNC_TTL_MINUTES,
      config.SYNC_REVISION_WINDOW_DAYS,
      options.syncLogger,
    ),
    close: async () => {
      await pool.end();
    },
  };
}
