import pg from 'pg';
import { Decimal } from 'decimal.js';

const { Pool, types } = pg;

/**
 * Parsers de tipo do node-postgres.
 *
 * Por padrao o driver converte NUMERIC para string e DATE para um objeto Date
 * do JavaScript no fuso LOCAL. As duas conversoes sao armadilhas:
 *
 *  - NUMERIC -> string e na verdade o comportamento correto (preserva
 *    precisao); nos so o levamos adiante convertendo para Decimal no
 *    repositorio, nunca para Number.
 *
 *  - DATE -> Date local e um bug esperando acontecer: '2026-08-18' vira
 *    2026-08-17T21:00:00 em UTC-3 e a data "anda" um dia. Registramos um
 *    parser que devolve a string ISO crua, que e exatamente o que o dominio
 *    espera.
 */
const PG_TYPE_DATE = 1082;
types.setTypeParser(PG_TYPE_DATE, (value: string) => value);

export type DatabasePool = pg.Pool;

export function createPool(databaseUrl: string): DatabasePool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'pulse-fx-api',
  });

  // Um erro em cliente ocioso nao pode derrubar o processo inteiro.
  pool.on('error', (err) => {
    console.error('[db] erro em conexao ociosa do pool:', err.message);
  });

  return pool;
}

/** Converte um NUMERIC vindo do Postgres (string) para Decimal com seguranca. */
export function toDecimal(value: string | number): Decimal {
  return new Decimal(typeof value === 'number' ? value.toString() : value);
}

/** Espera o banco aceitar conexao. Usado no boot antes de migrar. */
export async function waitForDatabase(
  pool: DatabasePool,
  { attempts = 30, delayMs = 1000 }: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Banco de dados indisponivel apos ${attempts} tentativas: ${(lastError as Error)?.message}`,
  );
}
