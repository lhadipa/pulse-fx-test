import type { FavoriteRepository } from '../../../application/ports.js';
import type { DatabasePool } from '../client.js';

export class PostgresFavoriteRepository implements FavoriteRepository {
  constructor(private readonly pool: DatabasePool) {}

  async findCodesByClient(clientId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ code: string }>(
      `SELECT i.code
         FROM favorites f
         JOIN indicators i ON i.id = f.indicator_id
        WHERE f.client_id = $1
        ORDER BY i.display_order, i.code`,
      [clientId],
    );
    return rows.map((row) => row.code);
  }

  /** Idempotente: favoritar duas vezes nao e erro, e nao duplica linha. */
  async add(clientId: string, indicatorId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO favorites (client_id, indicator_id)
       VALUES ($1, $2)
       ON CONFLICT (client_id, indicator_id) DO NOTHING`,
      [clientId, indicatorId],
    );
  }

  /** Idempotente: desfavoritar o que nao era favorito devolve 204 do mesmo jeito. */
  async remove(clientId: string, indicatorId: number): Promise<void> {
    await this.pool.query(`DELETE FROM favorites WHERE client_id = $1 AND indicator_id = $2`, [
      clientId,
      indicatorId,
    ]);
  }
}
