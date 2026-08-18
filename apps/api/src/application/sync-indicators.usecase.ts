import { addDays, subtractYears } from '../domain/date.js';
import type { Indicator } from '../domain/types.js';
import type {
  Clock,
  IndicatorRepository,
  ObservationRepository,
  SeriesProvider,
  SyncRunRepository,
  SyncStatus,
  SyncTrigger,
} from './ports.js';

/**
 * Politica de sincronizacao (briefing, secao 4.4).
 *
 * A regra estruturante do Pulse FX e que a API DE LEITURA NUNCA CHAMA BCB OU
 * FRED. Ela le apenas o Postgres. Toda comunicacao com o mundo externo passa
 * por este caso de uso, disparado de tres formas - bootstrap, cron e endpoint
 * administrativo - mas sempre com os mesmos freios:
 *
 *   TTL      duas sincronizacoes bem-sucedidas do mesmo indicador nao ocorrem
 *            dentro da janela configurada. Sem isso, um usuario dando F5 no
 *            dashboard viraria trafego nas APIs publicas;
 *
 *   LOCK     advisory lock por indicador. O cron e uma chamada manual ao
 *            endpoint admin podem coincidir; o lock garante que apenas um dos
 *            dois fale com a fonte;
 *
 *   JANELA   sync incremental relê apenas os ultimos dias, nao o historico
 *            inteiro. A janela de revisao existe porque IPCA e CPI SAO
 *            REVISADOS depois de publicados;
 *
 *   AUDITORIA  toda execucao (inclusive as puladas por TTL) vira uma linha em
 *            sync_runs, o que permite responder "por que este numero esta
 *            velho?" sem adivinhacao.
 *
 * `force` (usado pelo endpoint admin) ignora o TTL, e e o unico bypass.
 */

export interface SyncOutcome {
  code: string;
  status: SyncStatus;
  rowsUpserted: number;
  error: string | null;
}

export interface SyncOptions {
  trigger: SyncTrigger;
  /** Restringe a sincronizacao a estes codigos. Vazio ou ausente = todos. */
  codes?: string[];
  /** Ignora o freio de TTL. Reservado ao endpoint administrativo. */
  force?: boolean;
}

export interface SyncLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

const noopLogger: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };

export class SyncIndicatorsUseCase {
  constructor(
    private readonly indicators: IndicatorRepository,
    private readonly observations: ObservationRepository,
    private readonly syncRuns: SyncRunRepository,
    /** Um provider por fonte, resolvido pelo campo `source` do indicador. */
    private readonly providers: Map<Indicator['source'], SeriesProvider>,
    private readonly clock: Clock,
    private readonly ttlMinutes: number,
    private readonly revisionWindowDays: number,
    private readonly logger: SyncLogger = noopLogger,
  ) {}

  /** true quando a ultima sync bem-sucedida ainda esta dentro do TTL. */
  private isWithinTtl(lastSuccessAt: Date | null): boolean {
    if (!lastSuccessAt || this.ttlMinutes <= 0) return false;
    const elapsedMs = this.clock.now().getTime() - lastSuccessAt.getTime();
    return elapsedMs < this.ttlMinutes * 60_000;
  }

  /**
   * Decide o intervalo a buscar.
   *
   * Serie vazia -> backfill completo (a primeira subida do ambiente).
   * Serie povoada -> apenas da ultima data conhecida menos a janela de
   * revisao ate hoje. Rebaixar o inicio e o que captura as revisoes que as
   * fontes publicam sem avisar.
   */
  private async resolveWindow(indicator: Indicator): Promise<{ from: string; to: string }> {
    const to = this.clock.today();
    const latest = await this.observations.findLatestRefDate(indicator.id);

    const from = latest
      ? addDays(latest, -this.revisionWindowDays)
      : subtractYears(to, indicator.backfillYears);

    return { from, to };
  }

  private async syncOne(indicator: Indicator, options: SyncOptions): Promise<SyncOutcome> {
    const provider = this.providers.get(indicator.source);

    if (!provider) {
      const error = `Nenhum provider registrado para a fonte ${indicator.source}`;
      await this.syncRuns.record({
        indicatorId: indicator.id,
        trigger: options.trigger,
        status: 'failed',
        rowsUpserted: 0,
        errorMessage: error,
      });
      return { code: indicator.code, status: 'failed', rowsUpserted: 0, error };
    }

    if (!options.force) {
      const lastSuccessAt = await this.syncRuns.findLastSuccessAt(indicator.id);
      if (this.isWithinTtl(lastSuccessAt)) {
        this.logger.info({ code: indicator.code }, 'sync ignorada: dentro do TTL');
        await this.syncRuns.record({
          indicatorId: indicator.id,
          trigger: options.trigger,
          status: 'skipped_ttl',
          rowsUpserted: 0,
          errorMessage: null,
        });
        return { code: indicator.code, status: 'skipped_ttl', rowsUpserted: 0, error: null };
      }
    }

    const locked = await this.syncRuns.withIndicatorLock(indicator.id, async () => {
      const { from, to } = await this.resolveWindow(indicator);

      try {
        const fetched = await provider.fetchObservations(indicator, from, to);
        const rowsUpserted = await this.observations.upsertMany(indicator.id, fetched);

        this.logger.info(
          { code: indicator.code, from, to, fetched: fetched.length, rowsUpserted },
          'sync concluida',
        );

        await this.syncRuns.record({
          indicatorId: indicator.id,
          trigger: options.trigger,
          status: 'success',
          rowsUpserted,
          errorMessage: null,
        });

        return { code: indicator.code, status: 'success' as const, rowsUpserted, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error({ code: indicator.code, err: message }, 'sync falhou');

        await this.syncRuns.record({
          indicatorId: indicator.id,
          trigger: options.trigger,
          status: 'failed',
          rowsUpserted: 0,
          errorMessage: message,
        });

        return { code: indicator.code, status: 'failed' as const, rowsUpserted: 0, error: message };
      }
    });

    // Lock nao obtido: outra instancia ja esta sincronizando esta serie.
    // Nao e erro nem trabalho pendente - e a protecao funcionando.
    if (locked === null) {
      this.logger.warn({ code: indicator.code }, 'sync ignorada: ja em andamento em outra instancia');
      return { code: indicator.code, status: 'skipped_ttl', rowsUpserted: 0, error: null };
    }

    return locked;
  }

  async execute(options: SyncOptions): Promise<SyncOutcome[]> {
    const all = await this.indicators.findAllActive();
    const requested = options.codes?.length ? new Set(options.codes) : null;
    const selected = requested ? all.filter((i) => requested.has(i.code)) : all;

    // Em serie, de proposito: as APIs publicas do BCB sao lentas e sem SLA.
    // Disparar dez requisicoes simultaneas contra elas seria exatamente o
    // "acesso descontrolado" que o briefing pede para evitar.
    const outcomes: SyncOutcome[] = [];
    for (const indicator of selected) {
      outcomes.push(await this.syncOne(indicator, options));
    }

    return outcomes;
  }
}
