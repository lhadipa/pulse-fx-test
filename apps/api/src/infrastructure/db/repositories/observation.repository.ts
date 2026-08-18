import type { ObservationRepository } from '../../../application/ports.js';
import type { Observation } from '../../../domain/types.js';
import { toDecimal, type DatabasePool } from '../client.js';

interface ObservationRow {
  ref_date: string;
  value: string;
}

function toDomain(row: ObservationRow): Observation {
  return { refDate: row.ref_date, value: toDecimal(row.value) };
}

export class PostgresObservationRepository implements ObservationRepository {
  constructor(private readonly pool: DatabasePool) {}

  /**
   * Traz as N observacoes mais recentes. O calculo de variacao so precisa de
   * poucas linhas, entao carregar a serie inteira para descobrir o valor de
   * ontem seria desperdicio - o indice (indicator_id, ref_date DESC) resolve
   * isso em leitura de indice.
   */
  async findRecent(indicatorId: number, limit: number): Promise<Observation[]> {
    const { rows } = await this.pool.query<ObservationRow>(
      `SELECT ref_date, value
         FROM observations
        WHERE indicator_id = $1
        ORDER BY ref_date DESC
        LIMIT $2`,
      [indicatorId, limit],
    );
    return rows.map(toDomain);
  }

  async findRange(
    indicatorId: number,
    from: string | null,
    to: string | null,
  ): Promise<Observation[]> {
    const { rows } = await this.pool.query<ObservationRow>(
      `SELECT ref_date, value
         FROM observations
        WHERE indicator_id = $1
          AND ($2::date IS NULL OR ref_date >= $2::date)
          AND ($3::date IS NULL OR ref_date <= $3::date)
        ORDER BY ref_date ASC`,
      [indicatorId, from, to],
    );
    return rows.map(toDomain);
  }

  async findLatestRefDate(indicatorId: number): Promise<string | null> {
    const { rows } = await this.pool.query<{ ref_date: string }>(
      `SELECT MAX(ref_date)::text AS ref_date FROM observations WHERE indicator_id = $1`,
      [indicatorId],
    );
    return rows[0]?.ref_date ?? null;
  }

  /**
   * Upsert em lote.
   *
   * ON CONFLICT DO UPDATE, e nao DO NOTHING, porque as fontes REVISAM dados
   * publicados: IPCA e CPI sao recalculados nos meses seguintes. Ignorar o
   * conflito deixaria o Pulse FX exibindo para sempre o primeiro valor
   * divulgado. Como efeito colateral, rodar a mesma sincronizacao duas vezes
   * e idempotente.
   *
   * Um unico INSERT com todas as tuplas evita N round-trips ao banco.
   */
  async upsertMany(indicatorId: number, observations: readonly Observation[]): Promise<number> {
    if (observations.length === 0) return 0;

    const values: unknown[] = [indicatorId];
    const tuples = observations.map((obs, index) => {
      values.push(obs.refDate, obs.value.toString());
      return `($1, $${index * 2 + 2}::date, $${index * 2 + 3}::numeric)`;
    });

    const result = await this.pool.query(
      `INSERT INTO observations (indicator_id, ref_date, value)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (indicator_id, ref_date)
       DO UPDATE SET value = EXCLUDED.value, ingested_at = now()
       WHERE observations.value IS DISTINCT FROM EXCLUDED.value`,
      values,
    );

    return result.rowCount ?? 0;
  }
}
