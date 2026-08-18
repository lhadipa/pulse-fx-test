import { createContainer } from './container.js';
import { loadConfig } from './infrastructure/config/env.js';
import { waitForDatabase } from './infrastructure/db/client.js';
import { runMigrations } from './infrastructure/db/migrator.js';
import { buildApp } from './interface/http/app.js';

/**
 * Entrypoint da API HTTP.
 *
 * A API nao sincroniza nada: quem fala com BCB e FRED e o worker. Aqui so
 * garantimos que o schema esta aplicado (o servico `migrate` do Compose ja
 * fez isso, mas rodar de novo e no-op e cobre `npm run dev` sem Docker) e
 * subimos o servidor.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const container = createContainer(config);

  await waitForDatabase(container.pool);
  await runMigrations(container.pool);

  const app = await buildApp(container);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'encerrando');
    await app.close();
    await container.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`Pulse FX API em http://${config.HOST}:${config.PORT} (docs em /docs)`);
}

main().catch((error: unknown) => {
  console.error('[api] falha ao iniciar:', error);
  process.exit(1);
});
