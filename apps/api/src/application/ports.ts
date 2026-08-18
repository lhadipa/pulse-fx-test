import type { Indicator, Observation } from '../domain/types.js';

/**
 * Portas da camada de aplicacao.
 *
 * Os casos de uso dependem destas interfaces, nunca de Postgres ou de fetch.
 * E o que permite testar a regra de negocio com dublês em memoria e trocar
 * uma fonte de dados sem tocar em nenhum caso de uso.
 */

export interface IndicatorRepository {
  findAllActive(): Promise<Indicator[]>;
  findByCode(code: string): Promise<Indicator | null>;
}

export interface ObservationRepository {
  /** Observacoes mais recentes de um indicador, da mais nova para a mais antiga. */
  findRecent(indicatorId: number, limit: number): Promise<Observation[]>;
  /** Observacoes num intervalo fechado de datas, em ordem cronologica. */
  findRange(indicatorId: number, from: string | null, to: string | null): Promise<Observation[]>;
  /** Data de referencia mais recente ja persistida, ou null se a serie esta vazia. */
  findLatestRefDate(indicatorId: number): Promise<string | null>;
  /** Insere ou atualiza em lote. Devolve quantas linhas foram gravadas. */
  upsertMany(indicatorId: number, observations: readonly Observation[]): Promise<number>;
}

export type SyncTrigger = 'bootstrap' | 'cron' | 'admin';
export type SyncStatus = 'success' | 'failed' | 'skipped_ttl';

export interface SyncRunRecord {
  indicatorId: number;
  trigger: SyncTrigger;
  status: SyncStatus;
  rowsUpserted: number;
  errorMessage: string | null;
}

export interface SyncRunRepository {
  /** Instante da ultima sync bem-sucedida, usado pelo freio de TTL. */
  findLastSuccessAt(indicatorId: number): Promise<Date | null>;
  findLastSuccessAtByIndicator(): Promise<Map<number, Date>>;
  record(run: SyncRunRecord): Promise<void>;
  /**
   * Executa `fn` sob um advisory lock exclusivo do indicador. Se outra
   * instancia ja detem o lock, devolve `null` sem esperar - a sync alheia ja
   * esta fazendo o trabalho.
   */
  withIndicatorLock<T>(indicatorId: number, fn: () => Promise<T>): Promise<T | null>;
}

export interface FavoriteRepository {
  findCodesByClient(clientId: string): Promise<string[]>;
  add(clientId: string, indicatorId: number): Promise<void>;
  remove(clientId: string, indicatorId: number): Promise<void>;
}

/**
 * Porta unica das fontes externas. BCB SGS, BCB PTAX e FRED implementam a
 * mesma interface, o que faz o caso de uso de sincronizacao nao ter um unico
 * `if` sobre qual fonte esta sendo lida.
 */
export interface SeriesProvider {
  readonly source: Indicator['source'];
  /** Busca observacoes no intervalo [from, to]. Datas em ISO YYYY-MM-DD. */
  fetchObservations(indicator: Indicator, from: string, to: string): Promise<Observation[]>;
}

export interface Clock {
  /** Data de hoje em ISO YYYY-MM-DD (UTC). */
  today(): string;
  now(): Date;
}

export const systemClock: Clock = {
  today: () => new Date().toISOString().slice(0, 10),
  now: () => new Date(),
};
