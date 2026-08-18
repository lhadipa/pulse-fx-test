import { z } from 'zod';

/**
 * Configuracao da aplicacao.
 *
 * O schema falha rapido no boot: um container que sobe sem DATABASE_URL deve
 * morrer imediatamente com uma mensagem clara, e nao devolver 500 na primeira
 * requisicao de um usuario.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),

  /**
   * Chave da API do FRED. Sem ela a API responde 400.
   * Registro gratuito em https://fredaccount.stlouisfed.org/apikeys
   */
  FRED_API_KEY: z.string().default(''),

  /** Bearer token do endpoint administrativo de sincronizacao. */
  ADMIN_TOKEN: z.string().min(8, 'ADMIN_TOKEN deve ter ao menos 8 caracteres').default('pulse-fx-dev-admin-token'),

  /**
   * Janela minima entre duas sincronizacoes bem-sucedidas do mesmo indicador.
   * E o principal freio contra chamadas redundantes as APIs externas.
   */
  SYNC_TTL_MINUTES: z.coerce.number().int().nonnegative().default(30),

  /** Se o worker deve sincronizar assim que sobe. */
  SYNC_ON_BOOTSTRAP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Cron das series diarias e das mensais (horario UTC do container). */
  SYNC_CRON_DAILY: z.string().default('*/30 12-23 * * 1-5'),
  SYNC_CRON_MONTHLY: z.string().default('0 9 * * *'),

  /** Janela relida a cada sync incremental, para capturar revisoes da fonte. */
  SYNC_REVISION_WINDOW_DAYS: z.coerce.number().int().nonnegative().default(5),

  /** Timeout e retries das chamadas HTTP externas. */
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  HTTP_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),

  CORS_ORIGIN: z.string().default('*'),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracao invalida:\n${details}`);
  }

  return Object.freeze(parsed.data);
}
