import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Decimal } from 'decimal.js';
import { createPool, type DatabasePool } from '../client.js';
import { runMigrations } from '../migrator.js';
import { PostgresIndicatorRepository } from './indicator.repository.js';
import { PostgresObservationRepository } from './observation.repository.js';
import { PostgresSyncRunRepository } from './sync-run.repository.js';
import { PostgresFavoriteRepository } from './favorite.repository.js';
import { obs } from '../../../test/fakes.js';

/**
 * Teste de integracao contra um PostgreSQL REAL.
 *
 * Os dublês em memoria provam a regra de negocio, mas nao provam o SQL: um
 * ON CONFLICT errado, um tipo NUMERIC mal mapeado ou um DATE deslocado por
 * timezone so aparecem contra o banco de verdade. Por isso este arquivo existe
 * separado, com sufixo .integration.test.ts.
 *
 * Como rodar:
 *   docker compose up -d postgres-test
 *   npm run test:integration --workspace @pulse-fx/api
 *
 * Se o banco nao estiver acessivel o teste FALHA com mensagem explicita, em
 * vez de ser silenciosamente pulado - um teste pulado que ninguem percebe e
 * pior que teste nenhum.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://pulse:pulse@localhost:5433/pulse_fx_test';

const CLIENT_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const CLIENT_B = '11111111-2222-3333-4444-555555555555';

let pool: DatabasePool;
let indicators: PostgresIndicatorRepository;
let observations: PostgresObservationRepository;
let syncRuns: PostgresSyncRunRepository;
let favorites: PostgresFavoriteRepository;
let usdId: number;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(
      `Nao foi possivel conectar em ${TEST_DATABASE_URL}.\n` +
        'Suba o banco de teste com: docker compose up -d postgres-test\n' +
        `Causa: ${(error as Error).message}`,
    );
  }

  // Schema limpo a cada execucao: garante que o teste valida as migrations
  // versionadas, e nao um banco que alguem mexeu a mao.
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(pool, { logger: { info: () => undefined } });

  indicators = new PostgresIndicatorRepository(pool);
  observations = new PostgresObservationRepository(pool);
  syncRuns = new PostgresSyncRunRepository(pool);
  favorites = new PostgresFavoriteRepository(pool);

  const usd = await indicators.findByCode('usd-brl-ptax');
  if (!usd) throw new Error('Seed de indicadores nao foi aplicado pelas migrations.');
  usdId = usd.id;
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM observations');
  await pool.query('DELETE FROM sync_runs');
  await pool.query('DELETE FROM favorites');
});

describe('migrations', () => {
  it('aplicam o catalogo de indicadores com justificativa e limitacoes', async () => {
    const all = await indicators.findAllActive();

    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const indicator of all) {
      expect(indicator.rationale.length).toBeGreaterThan(50);
      expect(indicator.limitations.length).toBeGreaterThan(50);
      expect(indicator.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('cobrem as duas fontes obrigatorias e as duas frequencias', async () => {
    const all = await indicators.findAllActive();
    const sources = new Set(all.map((i) => i.source));
    const frequencies = new Set(all.map((i) => i.frequency));

    expect(sources).toContain('BCB_SGS');
    expect(sources).toContain('BCB_PTAX');
    expect(sources).toContain('FRED');
    expect(frequencies).toContain('DAILY');
    expect(frequencies).toContain('MONTHLY');
  });

  it('sao idempotentes: rodar de novo nao reaplica nada', async () => {
    const applied = await runMigrations(pool, { logger: { info: () => undefined } });
    expect(applied).toEqual([]);
  });
});

describe('PostgresObservationRepository', () => {
  it('persiste e le preservando a precisao decimal', async () => {
    await observations.upsertMany(usdId, [obs('2026-08-12', '5.16390')]);

    const [stored] = await observations.findRange(usdId, null, null);
    expect(stored!.value).toBeInstanceOf(Decimal);
    expect(stored!.value.toFixed(5)).toBe('5.16390');
  });

  it('nao desloca a data por timezone (DATE volta como string ISO crua)', async () => {
    // Com o parser default do node-postgres, '2026-01-01' viraria um Date no
    // fuso local e poderia ser lido como 2025-12-31 em UTC-3.
    await observations.upsertMany(usdId, [obs('2026-01-01', '5.00')]);

    const [stored] = await observations.findRange(usdId, null, null);
    expect(stored!.refDate).toBe('2026-01-01');
  });

  it('e idempotente: o mesmo lote duas vezes nao duplica linha', async () => {
    const batch = [obs('2026-08-11', '5.12850'), obs('2026-08-12', '5.16390')];

    const first = await observations.upsertMany(usdId, batch);
    const second = await observations.upsertMany(usdId, batch);

    expect(first).toBe(2);
    // Nada mudou: o WHERE ... IS DISTINCT FROM evita escrita desnecessaria.
    expect(second).toBe(0);
    expect(await observations.findRange(usdId, null, null)).toHaveLength(2);
  });

  it('atualiza o valor quando a fonte revisa a mesma data', async () => {
    await observations.upsertMany(usdId, [obs('2026-08-12', '5.16390')]);
    const changed = await observations.upsertMany(usdId, [obs('2026-08-12', '5.20000')]);

    expect(changed).toBe(1);
    const [stored] = await observations.findRange(usdId, null, null);
    expect(stored!.value.toFixed(4)).toBe('5.2000');
  });

  it('findRecent devolve as mais novas primeiro, respeitando o limite', async () => {
    await observations.upsertMany(usdId, [
      obs('2026-08-10', '5.09'),
      obs('2026-08-11', '5.12'),
      obs('2026-08-12', '5.16'),
    ]);

    const recent = await observations.findRecent(usdId, 2);
    expect(recent.map((o) => o.refDate)).toEqual(['2026-08-12', '2026-08-11']);
  });

  it('findRange filtra pelo intervalo e devolve em ordem cronologica', async () => {
    await observations.upsertMany(usdId, [
      obs('2026-08-10', '5.09'),
      obs('2026-08-11', '5.12'),
      obs('2026-08-12', '5.16'),
    ]);

    const range = await observations.findRange(usdId, '2026-08-11', '2026-08-12');
    expect(range.map((o) => o.refDate)).toEqual(['2026-08-11', '2026-08-12']);
  });

  it('findLatestRefDate devolve null para serie vazia', async () => {
    expect(await observations.findLatestRefDate(usdId)).toBeNull();
  });

  it('lote vazio nao gera SQL invalido', async () => {
    expect(await observations.upsertMany(usdId, [])).toBe(0);
  });

  it('grava valores negativos, como o IGP-M em deflacao', async () => {
    const igpm = await indicators.findByCode('igpm-monthly');
    await observations.upsertMany(igpm!.id, [obs('2026-07-01', '-1.16')]);

    const [stored] = await observations.findRange(igpm!.id, null, null);
    expect(stored!.value.toFixed(2)).toBe('-1.16');
  });
});

describe('PostgresSyncRunRepository', () => {
  it('registra execucoes e devolve a ultima bem-sucedida', async () => {
    await syncRuns.record({
      indicatorId: usdId,
      trigger: 'cron',
      status: 'failed',
      rowsUpserted: 0,
      errorMessage: 'boom',
    });
    await syncRuns.record({
      indicatorId: usdId,
      trigger: 'cron',
      status: 'success',
      rowsUpserted: 3,
      errorMessage: null,
    });

    const last = await syncRuns.findLastSuccessAt(usdId);
    expect(last).toBeInstanceOf(Date);
  });

  it('ignora execucoes falhas ao calcular a ultima sincronizacao', async () => {
    await syncRuns.record({
      indicatorId: usdId,
      trigger: 'cron',
      status: 'failed',
      rowsUpserted: 0,
      errorMessage: 'boom',
    });

    expect(await syncRuns.findLastSuccessAt(usdId)).toBeNull();
  });

  it('resolve o lastSyncedAt de todos os indicadores numa unica consulta', async () => {
    const ipca = await indicators.findByCode('ipca-monthly');
    await syncRuns.record({
      indicatorId: usdId,
      trigger: 'cron',
      status: 'success',
      rowsUpserted: 1,
      errorMessage: null,
    });
    await syncRuns.record({
      indicatorId: ipca!.id,
      trigger: 'cron',
      status: 'success',
      rowsUpserted: 1,
      errorMessage: null,
    });

    const map = await syncRuns.findLastSuccessAtByIndicator();
    expect(map.has(usdId)).toBe(true);
    expect(map.has(ipca!.id)).toBe(true);
  });

  it('o advisory lock impede duas sincronizacoes simultaneas do mesmo indicador', async () => {
    let innerAcquired: boolean | null = null;

    await syncRuns.withIndicatorLock(usdId, async () => {
      // Enquanto o lock externo esta ativo, uma segunda tentativa desiste na
      // hora em vez de enfileirar.
      const inner = await syncRuns.withIndicatorLock(usdId, async () => 'nao deveria rodar');
      innerAcquired = inner !== null;
      return 'ok';
    });

    expect(innerAcquired).toBe(false);
  });

  it('libera o lock mesmo quando o trabalho lanca excecao', async () => {
    await expect(
      syncRuns.withIndicatorLock(usdId, async () => {
        throw new Error('falha durante a sync');
      }),
    ).rejects.toThrow('falha durante a sync');

    // Se o lock tivesse vazado, esta chamada devolveria null.
    const result = await syncRuns.withIndicatorLock(usdId, async () => 'liberado');
    expect(result).toBe('liberado');
  });
});

describe('PostgresFavoriteRepository', () => {
  it('persiste favoritos de verdade, por cliente', async () => {
    await favorites.add(CLIENT_A, usdId);

    expect(await favorites.findCodesByClient(CLIENT_A)).toEqual(['usd-brl-ptax']);
    expect(await favorites.findCodesByClient(CLIENT_B)).toEqual([]);
  });

  it('favoritar duas vezes e idempotente', async () => {
    await favorites.add(CLIENT_A, usdId);
    await favorites.add(CLIENT_A, usdId);

    expect(await favorites.findCodesByClient(CLIENT_A)).toHaveLength(1);
  });

  it('remover o que nao existe nao e erro', async () => {
    await expect(favorites.remove(CLIENT_A, usdId)).resolves.toBeUndefined();
  });

  it('apagar um indicador remove os favoritos em cascata', async () => {
    await favorites.add(CLIENT_A, usdId);
    await pool.query('DELETE FROM indicators WHERE id = $1', [usdId]);

    expect(await favorites.findCodesByClient(CLIENT_A)).toEqual([]);
    // Restaura o catalogo para nao contaminar os testes seguintes.
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool, { logger: { info: () => undefined } });
    const usd = await indicators.findByCode('usd-brl-ptax');
    usdId = usd!.id;
  });
});
