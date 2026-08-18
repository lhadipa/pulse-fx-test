/**
 * Entrypoint do servico `migrate` do Docker Compose.
 * Sobe, espera o Postgres aceitar conexao, aplica o que falta e sai.
 */
import { loadConfig } from '../config/env.js';
import { createPool, waitForDatabase } from './client.js';
import { runMigrations } from './migrator.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);

  try {
    await waitForDatabase(pool);
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] falhou:', error);
  process.exitCode = 1;
});
