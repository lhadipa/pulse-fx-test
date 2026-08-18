import { Decimal } from 'decimal.js';
import type {
  Clock,
  FavoriteRepository,
  IndicatorRepository,
  ObservationRepository,
  SeriesProvider,
  SyncRunRecord,
  SyncRunRepository,
} from '../application/ports.js';
import type { Indicator, Observation } from '../domain/types.js';

/**
 * Dublês em memoria das portas da aplicacao.
 *
 * Existem porque os casos de uso dependem de interfaces, nao de Postgres: e o
 * que permite testar rota e regra de negocio sem infraestrutura, em
 * milissegundos e de forma deterministica.
 */

export function makeIndicator(overrides: Partial<Indicator> = {}): Indicator {
  return {
    id: 1,
    code: 'usd-brl-ptax',
    source: 'BCB_PTAX',
    externalId: 'CotacaoDolarPeriodo',
    name: 'Dolar americano PTAX (venda)',
    shortName: 'USD/BRL PTAX',
    unit: 'BRL',
    frequency: 'DAILY',
    variationLag: 1,
    precision: 4,
    rationale: 'Taxa oficial de cambio do Banco Central.',
    limitations: 'Divulgada apenas em dias uteis.',
    sourceUrl: 'https://olinda.bcb.gov.br/',
    backfillYears: 5,
    active: true,
    ...overrides,
  };
}

export const obs = (refDate: string, value: string): Observation => ({
  refDate,
  value: new Decimal(value),
});

export class FakeIndicatorRepository implements IndicatorRepository {
  constructor(private readonly indicators: Indicator[]) {}

  async findAllActive(): Promise<Indicator[]> {
    return this.indicators.filter((i) => i.active);
  }

  async findByCode(code: string): Promise<Indicator | null> {
    return this.indicators.find((i) => i.code === code) ?? null;
  }
}

export class FakeObservationRepository implements ObservationRepository {
  /** indicatorId -> refDate -> valor. Espelha a PK composta da tabela real. */
  private readonly store = new Map<number, Map<string, Observation>>();

  seed(indicatorId: number, observations: readonly Observation[]): void {
    const series = this.store.get(indicatorId) ?? new Map<string, Observation>();
    for (const o of observations) series.set(o.refDate, o);
    this.store.set(indicatorId, series);
  }

  private sortedDesc(indicatorId: number): Observation[] {
    return [...(this.store.get(indicatorId)?.values() ?? [])].sort((a, b) =>
      a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0,
    );
  }

  async findRecent(indicatorId: number, limit: number): Promise<Observation[]> {
    return this.sortedDesc(indicatorId).slice(0, limit);
  }

  async findRange(
    indicatorId: number,
    from: string | null,
    to: string | null,
  ): Promise<Observation[]> {
    return this.sortedDesc(indicatorId)
      .filter((o) => (!from || o.refDate >= from) && (!to || o.refDate <= to))
      .reverse();
  }

  async findLatestRefDate(indicatorId: number): Promise<string | null> {
    return this.sortedDesc(indicatorId)[0]?.refDate ?? null;
  }

  /** Mesma semantica do upsert real: so conta linha que de fato mudou. */
  async upsertMany(indicatorId: number, observations: readonly Observation[]): Promise<number> {
    const series = this.store.get(indicatorId) ?? new Map<string, Observation>();
    let changed = 0;

    for (const o of observations) {
      const existing = series.get(o.refDate);
      if (!existing || !existing.value.equals(o.value)) {
        series.set(o.refDate, o);
        changed += 1;
      }
    }

    this.store.set(indicatorId, series);
    return changed;
  }
}

export class FakeSyncRunRepository implements SyncRunRepository {
  readonly runs: SyncRunRecord[] = [];
  private readonly lastSuccess = new Map<number, Date>();
  /** Simula o lock ja tomado por outra instancia. */
  lockedIndicators = new Set<number>();

  constructor(private readonly clock: Clock) {}

  async findLastSuccessAt(indicatorId: number): Promise<Date | null> {
    return this.lastSuccess.get(indicatorId) ?? null;
  }

  async findLastSuccessAtByIndicator(): Promise<Map<number, Date>> {
    return new Map(this.lastSuccess);
  }

  async record(run: SyncRunRecord): Promise<void> {
    this.runs.push(run);
    if (run.status === 'success') this.lastSuccess.set(run.indicatorId, this.clock.now());
  }

  async withIndicatorLock<T>(indicatorId: number, fn: () => Promise<T>): Promise<T | null> {
    if (this.lockedIndicators.has(indicatorId)) return null;
    this.lockedIndicators.add(indicatorId);
    try {
      return await fn();
    } finally {
      this.lockedIndicators.delete(indicatorId);
    }
  }
}

export class FakeFavoriteRepository implements FavoriteRepository {
  private readonly store = new Map<string, Set<number>>();

  constructor(private readonly indicators: Indicator[]) {}

  async findCodesByClient(clientId: string): Promise<string[]> {
    const ids = this.store.get(clientId) ?? new Set<number>();
    return this.indicators.filter((i) => ids.has(i.id)).map((i) => i.code);
  }

  async add(clientId: string, indicatorId: number): Promise<void> {
    const ids = this.store.get(clientId) ?? new Set<number>();
    ids.add(indicatorId);
    this.store.set(clientId, ids);
  }

  async remove(clientId: string, indicatorId: number): Promise<void> {
    this.store.get(clientId)?.delete(indicatorId);
  }
}

export class FakeSeriesProvider implements SeriesProvider {
  calls: Array<{ code: string; from: string; to: string }> = [];
  private failure: Error | null = null;

  constructor(
    readonly source: Indicator['source'],
    private observations: Observation[] = [],
  ) {}

  setObservations(observations: Observation[]): void {
    this.observations = observations;
  }

  failWith(error: Error): void {
    this.failure = error;
  }

  async fetchObservations(indicator: Indicator, from: string, to: string): Promise<Observation[]> {
    this.calls.push({ code: indicator.code, from, to });
    if (this.failure) throw this.failure;
    return this.observations;
  }
}

/** Relogio fixo: torna testes de TTL e de data futura deterministicos. */
export class FakeClock implements Clock {
  constructor(private current: Date) {}

  today(): string {
    return this.current.toISOString().slice(0, 10);
  }

  now(): Date {
    return this.current;
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
