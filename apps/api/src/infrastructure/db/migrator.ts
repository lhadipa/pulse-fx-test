import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

/**
 * Migrator minimo, explicito e sem codegen.
 *
 * Optamos por SQL escrito a mao em vez de um ORM com geracao automatica de
 * migrations. Em um produto financeiro o schema e um artefato de revisao: quem
 * le o PR precisa ver exatamente qual DDL vai rodar em producao, e nao um
 * diff gerado por ferramenta. O custo e ~60 linhas; o beneficio e nao ter
 * nenhuma surpresa entre o que esta no arquivo e o que o banco recebe.
 *
 * Garantias:
 *  - arquivos aplicados em ordem lexicografica (0001_, 0002_, ...);
 *  - cada arquivo roda dentro de UMA transacao: falhou, nao aplicou nada;
 *  - um lock de sessao impede que duas instancias migrem em paralelo, o que
 *    acontece de verdade quando api e worker sobem juntos no Compose;
 *  - re-execucao e no-op (a tabela de controle registra o que ja rodou).
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

/** Chave arbitraria e fixa do advisory lock de migracao. */
const MIGRATION_LOCK_KEY = 947_112_003;

const CONTROL_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

export interface MigrationLogger {
  info: (msg: string) => void;
}

const consoleLogger: MigrationLogger = { info: (msg) => console.log(`[migrate] ${msg}`) };

async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

async function applyOne(client: PoolClient, dir: string, filename: string): Promise<void> {
  const sql = await readFile(join(dir, filename), 'utf8');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Falha ao aplicar a migration ${filename}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

export async function runMigrations(
  pool: Pool,
  options: { dir?: string; logger?: MigrationLogger } = {},
): Promise<string[]> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const logger = options.logger ?? consoleLogger;
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    // Bloqueia ate conseguir o lock: api e worker sobem juntos e ambos chamam
    // esta funcao. O segundo espera e depois encontra tudo ja aplicado.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(CONTROL_TABLE);

    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const done = new Set(rows.map((r) => r.filename));
    const files = await listMigrationFiles(dir);

    for (const filename of files) {
      if (done.has(filename)) continue;
      logger.info(`aplicando ${filename}`);
      await applyOne(client, dir, filename);
      applied.push(filename);
    }

    logger.info(
      applied.length === 0
        ? `schema ja atualizado (${files.length} migrations)`
        : `${applied.length} migration(s) aplicada(s)`,
    );
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
