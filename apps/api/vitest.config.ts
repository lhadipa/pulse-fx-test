import { defineConfig } from 'vitest/config';

/**
 * Configuracao padrao: testes que NAO precisam de infraestrutura.
 * Rodam em qualquer maquina, sem Docker e sem rede.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
