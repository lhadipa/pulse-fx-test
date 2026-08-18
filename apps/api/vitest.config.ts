import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    // Testes de integracao tocam um Postgres real; rodam em serie para nao
    // disputar o mesmo schema.
    poolOptions: { threads: { singleThread: true } },
  },
});
