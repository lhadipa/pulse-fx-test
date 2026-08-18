import { defineConfig } from 'vitest/config';

/**
 * Testes de integracao contra um PostgreSQL real.
 * Exigem `docker compose up -d postgres-test`.
 *
 * Rodam em thread unica: compartilham o mesmo schema e nao podem competir
 * pelas mesmas tabelas.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
