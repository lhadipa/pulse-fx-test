import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.config.js'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  /**
   * Regra de dependencia entre camadas.
   *
   * O dominio e PURO: nao pode importar infraestrutura, HTTP nem bibliotecas
   * de I/O. Sem isto, a separacao em camadas vira convencao verbal que se
   * degrada no primeiro atalho - aqui ela e verificavel pelo lint e quebra o
   * CI.
   */
  {
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../infrastructure/*',
                '../application/*',
                '../interface/*',
                'pg',
                'fastify',
                'node:fs',
                'node:http',
              ],
              message:
                'A camada de dominio deve permanecer pura: sem I/O, sem framework, sem banco.',
            },
          ],
        },
      ],
    },
  },

  /**
   * A camada de aplicacao orquestra casos de uso atraves de portas. Ela nao
   * pode conhecer implementacoes concretas nem o framework HTTP.
   */
  {
    files: ['apps/api/src/application/**/*.ts'],
    ignores: ['apps/api/src/application/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../infrastructure/*', '../interface/*', 'pg', 'fastify'],
              message:
                'Casos de uso dependem de portas (interfaces), nunca de implementacoes concretas.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
