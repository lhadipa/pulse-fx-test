import type { IndicatorRepository } from '../../../application/ports.js';
import type { Indicator } from '../../../domain/types.js';
import type { DatabasePool } from '../client.js';

interface IndicatorRow {
  id: number;
  code: string;
  source: Indicator['source'];
  external_id: string;
  name: string;
  short_name: string;
  unit: Indicator['unit'];
  frequency: Indicator['frequency'];
  variation_lag: number;
  precision: number;
  rationale: string;
  limitations: string;
  source_url: string;
  backfill_years: number;
  active: boolean;
}

const SELECT_COLUMNS = `
  id, code, source, external_id, name, short_name, unit, frequency,
  variation_lag, precision, rationale, limitations, source_url,
  backfill_years, active
`;

function toDomain(row: IndicatorRow): Indicator {
  return {
    id: row.id,
    code: row.code,
    source: row.source,
    externalId: row.external_id,
    name: row.name,
    shortName: row.short_name,
    unit: row.unit,
    frequency: row.frequency,
    variationLag: row.variation_lag,
    precision: row.precision,
    rationale: row.rationale,
    limitations: row.limitations,
    sourceUrl: row.source_url,
    backfillYears: row.backfill_years,
    active: row.active,
  };
}

export class PostgresIndicatorRepository implements IndicatorRepository {
  constructor(private readonly pool: DatabasePool) {}

  async findAllActive(): Promise<Indicator[]> {
    const { rows } = await this.pool.query<IndicatorRow>(
      `SELECT ${SELECT_COLUMNS} FROM indicators WHERE active = TRUE ORDER BY display_order, code`,
    );
    return rows.map(toDomain);
  }

  async findByCode(code: string): Promise<Indicator | null> {
    const { rows } = await this.pool.query<IndicatorRow>(
      `SELECT ${SELECT_COLUMNS} FROM indicators WHERE code = $1`,
      [code],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }
}
