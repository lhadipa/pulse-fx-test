import type { SyncRunRecord, SyncRunRepository } from '../../../application/ports.js';
import type { DatabasePool } from '../client.js';

/**
 * Namespace do advisory lock por indicador. Postgres oferece locks de dois
 * inteiros (classe, chave); usar uma classe fixa evita colidir com qualquer
 * outro lock da aplicacao.
 */
const SYNC_LOCK_NAMESPACE = 8_213_004;

export class PostgresSyncRunRepository implements SyncRunRepository {
  constructor(private readonly pool: DatabasePool) {}

  async findLastSuccessAt(indicatorId: number): Promise<Date | null> {
    const { rows } = await this.pool.query<{ finished_at: Date }>(
      `SELECT finished_at
         FROM sync_runs
        WHERE indicator_id = $1 AND status = 'success'
        ORDER BY finished_at DESC
        LIMIT 1`,
      [indicatorId],
    );
    return rows[0]?.finished_at ?? null;
  }

  /**
   * Uma unica query para todos os indicadores: o dashboard lista N series e
   * precisa do lastSyncedAt de cada uma. Fazer isso em loop seria um N+1
   * classico.
   */
  async findLastSuccessAtByIndicator(): Promise<Map<number, Date>> {
    const { rows } = await this.pool.query<{ indicator_id: number; finished_at: Date }>(
      `SELECT DISTINCT ON (indicator_id) indicator_id, finished_at
         FROM sync_runs
        WHERE status = 'success' AND finished_at IS NOT NULL
        ORDER BY indicator_id, finished_at DESC`,
    );
    return new Map(rows.map((row) => [row.indicator_id, row.finished_at]));
  }

  async record(run: SyncRunRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_runs
         (indicator_id, trigger, status, rows_upserted, error_message, finished_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [run.indicatorId, run.trigger, run.status, run.rowsUpserted, run.errorMessage],
    );
  }

  /**
   * Lock nao-bloqueante por indicador.
   *
   * Sem isto, o cron do worker e uma chamada manual ao endpoint admin podem
   * sincronizar a mesma serie ao mesmo tempo e bater nas APIs externas em
   * duplicidade - exatamente o que o briefing pede para evitar. `try_advisory`
   * desiste na hora em vez de enfileirar: se outro processo ja esta cuidando
   * daquela serie, nao ha nada a fazer.
   */
  async withIndicatorLock<T>(indicatorId: number, fn: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [SYNC_LOCK_NAMESPACE, indicatorId],
      );

      if (!rows[0]?.locked) return null;

      try {
        return await fn();
      } finally {
        await client
          .query('SELECT pg_advisory_unlock($1, $2)', [SYNC_LOCK_NAMESPACE, indicatorId])
          .catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }
}
