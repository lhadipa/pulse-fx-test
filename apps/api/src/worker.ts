import cron from 'node-cron';
import { createContainer } from './container.js';
import { loadConfig } from './infrastructure/config/env.js';
import { waitForDatabase } from './infrastructure/db/client.js';
import { runMigrations } from './infrastructure/db/migrator.js';

/**
 * Worker de sincronizacao.
 *
 * Processo separado da API de proposito: uma instabilidade do BCB ou do FRED
 * nao pode afetar a latencia nem a disponibilidade das leituras. Se este
 * processo cair, o dashboard continua servindo o ultimo dado persistido - com
 * o campo lastSyncedAt deixando claro que ele envelheceu.
 */

const log = {
  info: (obj: Record<string, unknown>, msg: string) =>
    console.log(JSON.stringify({ level: 'info', msg, ...obj })),
  warn: (obj: Record<string, unknown>, msg: string) =>
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj })),
  error: (obj: Record<string, unknown>, msg: string) =>
    console.error(JSON.stringify({ level: 'error', msg, ...obj })),
};

async function main(): Promise<void> {
  const config = loadConfig();
  const container = createContainer(config, { syncLogger: log });

  await waitForDatabase(container.pool);
  await runMigrations(container.pool);

  /** Uma execucao nunca pode derrubar o worker: erro e logado, nao propagado. */
  const runSync = async (trigger: 'bootstrap' | 'cron', force = false): Promise<void> => {
    try {
      const results = await container.syncIndicators.execute({ trigger, force });
      const summary = results.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {});
      log.info({ trigger, summary }, 'ciclo de sincronizacao concluido');
    } catch (error) {
      log.error({ trigger, err: (error as Error).message }, 'ciclo de sincronizacao falhou');
    }
  };

  if (config.SYNC_ON_BOOTSTRAP) {
    // `force` no bootstrap: um ambiente recem-criado precisa de dado na tela,
    // e o TTL de uma execucao anterior nao deve impedir o primeiro backfill.
    log.info({}, 'executando sincronizacao de bootstrap');
    await runSync('bootstrap', true);
  }

  cron.schedule(config.SYNC_CRON_DAILY, () => void runSync('cron'));
  cron.schedule(config.SYNC_CRON_MONTHLY, () => void runSync('cron'));

  log.info(
    { daily: config.SYNC_CRON_DAILY, monthly: config.SYNC_CRON_MONTHLY, ttl: config.SYNC_TTL_MINUTES },
    'worker agendado',
  );

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'encerrando worker');
    await container.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[worker] falha ao iniciar:', error);
  process.exit(1);
});
