import { describe, it, expect, beforeEach } from 'vitest';
import { SyncIndicatorsUseCase } from './sync-indicators.usecase.js';
import { ListIndicatorsUseCase } from './list-indicators.usecase.js';
import type { SeriesProvider } from './ports.js';
import type { Indicator } from '../domain/types.js';
import {
  FakeClock,
  FakeFavoriteRepository,
  FakeIndicatorRepository,
  FakeObservationRepository,
  FakeSeriesProvider,
  FakeSyncRunRepository,
  makeIndicator,
  obs,
} from '../test/fakes.js';

/**
 * Testes da politica de sincronizacao (briefing, secao 4.4).
 *
 * O que estes testes protegem e o requisito de NAO fazer chamadas
 * descontroladas as APIs externas. Cada asserção sobre `provider.calls`
 * verifica literalmente quantas vezes o BCB/FRED seria acionado.
 */

const TTL_MINUTES = 30;
const REVISION_WINDOW_DAYS = 5;

const USD = makeIndicator({ id: 1, code: 'usd-brl-ptax', source: 'BCB_PTAX', backfillYears: 5 });
const IPCA = makeIndicator({
  id: 2,
  code: 'ipca-monthly',
  source: 'BCB_SGS',
  externalId: '433',
  frequency: 'MONTHLY',
  backfillYears: 10,
});

interface Harness {
  clock: FakeClock;
  provider: FakeSeriesProvider;
  sgsProvider: FakeSeriesProvider;
  observations: FakeObservationRepository;
  syncRuns: FakeSyncRunRepository;
  sync: SyncIndicatorsUseCase;
  indicators: FakeIndicatorRepository;
}

function makeHarness(): Harness {
  const clock = new FakeClock(new Date('2026-08-18T12:00:00Z'));
  const indicators = new FakeIndicatorRepository([USD, IPCA]);
  const observations = new FakeObservationRepository();
  const syncRuns = new FakeSyncRunRepository(clock);

  const provider = new FakeSeriesProvider('BCB_PTAX', [
    obs('2026-08-11', '5.12850'),
    obs('2026-08-12', '5.16390'),
  ]);
  const sgsProvider = new FakeSeriesProvider('BCB_SGS', [obs('2026-07-01', '0.07')]);

  const providers = new Map<Indicator['source'], SeriesProvider>([
    ['BCB_PTAX', provider],
    ['BCB_SGS', sgsProvider],
  ]);

  const sync = new SyncIndicatorsUseCase(
    indicators,
    observations,
    syncRuns,
    providers,
    clock,
    TTL_MINUTES,
    REVISION_WINDOW_DAYS,
  );

  return { clock, provider, sgsProvider, observations, syncRuns, sync, indicators };
}

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});

describe('freio de TTL', () => {
  it('sincroniza na primeira execucao', async () => {
    const results = await h.sync.execute({ trigger: 'cron' });

    expect(results.every((r) => r.status === 'success')).toBe(true);
    expect(h.provider.calls).toHaveLength(1);
  });

  it('NAO chama a fonte de novo dentro da janela de TTL', async () => {
    await h.sync.execute({ trigger: 'cron' });
    h.clock.advanceMinutes(TTL_MINUTES - 1);

    const results = await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });

    expect(results[0]!.status).toBe('skipped_ttl');
    // A chamada externa continua sendo uma so: o TTL segurou a segunda.
    expect(h.provider.calls).toHaveLength(1);
  });

  it('volta a sincronizar depois que o TTL expira', async () => {
    await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });
    h.clock.advanceMinutes(TTL_MINUTES + 1);

    const results = await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });

    expect(results[0]!.status).toBe('success');
    expect(h.provider.calls).toHaveLength(2);
  });

  it('force ignora o TTL - e o unico bypass, reservado ao endpoint admin', async () => {
    await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });
    h.clock.advanceMinutes(1);

    const results = await h.sync.execute({
      trigger: 'admin',
      codes: ['usd-brl-ptax'],
      force: true,
    });

    expect(results[0]!.status).toBe('success');
    expect(h.provider.calls).toHaveLength(2);
  });

  it('registra em sync_runs inclusive as execucoes puladas, para auditoria', async () => {
    await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });
    h.clock.advanceMinutes(1);
    await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });

    const statuses = h.syncRuns.runs.filter((r) => r.indicatorId === USD.id).map((r) => r.status);
    expect(statuses).toEqual(['success', 'skipped_ttl']);
  });
});

describe('idempotencia', () => {
  it('rodar a mesma sincronizacao duas vezes nao duplica observacoes', async () => {
    await h.sync.execute({ trigger: 'admin', codes: ['usd-brl-ptax'], force: true });
    const afterFirst = await h.observations.findRange(USD.id, null, null);

    await h.sync.execute({ trigger: 'admin', codes: ['usd-brl-ptax'], force: true });
    const afterSecond = await h.observations.findRange(USD.id, null, null);

    expect(afterFirst).toHaveLength(2);
    expect(afterSecond).toHaveLength(2);
  });

  it('a segunda execucao nao reporta linhas alteradas quando nada mudou', async () => {
    const first = await h.sync.execute({ trigger: 'admin', codes: ['usd-brl-ptax'], force: true });
    const second = await h.sync.execute({ trigger: 'admin', codes: ['usd-brl-ptax'], force: true });

    expect(first[0]!.rowsUpserted).toBe(2);
    expect(second[0]!.rowsUpserted).toBe(0);
  });

  it('atualiza o valor quando a fonte revisa um dado ja publicado', async () => {
    await h.sync.execute({ trigger: 'admin', codes: ['usd-brl-ptax'], force: true });

    // IPCA e CPI sao revisados; o upsert precisa refletir a revisao.
    h.provider.setObservations([obs('2026-08-12', '5.20000')]);
    const revised = await h.sync.execute({
      trigger: 'admin',
      codes: ['usd-brl-ptax'],
      force: true,
    });

    expect(revised[0]!.rowsUpserted).toBe(1);
    const stored = await h.observations.findRange(USD.id, '2026-08-12', '2026-08-12');
    expect(stored[0]!.value.toString()).toBe('5.2');
  });
});

describe('janela de busca', () => {
  it('faz backfill completo quando a serie esta vazia', async () => {
    await h.sync.execute({ trigger: 'bootstrap', force: true, codes: ['usd-brl-ptax'] });

    expect(h.provider.calls[0]).toMatchObject({ from: '2021-08-18', to: '2026-08-18' });
  });

  it('respeita backfillYears diferente por indicador', async () => {
    await h.sync.execute({ trigger: 'bootstrap', force: true, codes: ['ipca-monthly'] });

    expect(h.sgsProvider.calls[0]).toMatchObject({ from: '2016-08-18', to: '2026-08-18' });
  });

  it('sync incremental relê apenas a janela de revisao, nao o historico inteiro', async () => {
    await h.sync.execute({ trigger: 'bootstrap', force: true, codes: ['usd-brl-ptax'] });
    await h.sync.execute({ trigger: 'admin', force: true, codes: ['usd-brl-ptax'] });

    // Ultima data conhecida 2026-08-12, menos 5 dias de janela de revisao.
    expect(h.provider.calls[1]).toMatchObject({ from: '2026-08-07', to: '2026-08-18' });
  });
});

describe('resiliencia', () => {
  it('falha de um indicador nao impede a sincronizacao dos outros', async () => {
    h.provider.failWith(new Error('BCB fora do ar'));

    const results = await h.sync.execute({ trigger: 'cron' });

    expect(results.find((r) => r.code === 'usd-brl-ptax')!.status).toBe('failed');
    expect(results.find((r) => r.code === 'ipca-monthly')!.status).toBe('success');
  });

  it('grava a mensagem de erro em sync_runs para diagnostico', async () => {
    h.provider.failWith(new Error('BCB fora do ar'));
    await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });

    const failed = h.syncRuns.runs.find((r) => r.status === 'failed');
    expect(failed!.errorMessage).toContain('BCB fora do ar');
  });

  it('nao chama a fonte quando outra instancia ja detem o lock do indicador', async () => {
    h.syncRuns.lockedIndicators.add(USD.id);

    const results = await h.sync.execute({ trigger: 'cron', codes: ['usd-brl-ptax'] });

    expect(results[0]!.status).toBe('skipped_ttl');
    expect(h.provider.calls).toHaveLength(0);
  });

  it('marca como falha o indicador sem provider registrado', async () => {
    const clock = new FakeClock(new Date('2026-08-18T12:00:00Z'));
    const sync = new SyncIndicatorsUseCase(
      new FakeIndicatorRepository([USD]),
      new FakeObservationRepository(),
      new FakeSyncRunRepository(clock),
      new Map(),
      clock,
      TTL_MINUTES,
      REVISION_WINDOW_DAYS,
    );

    const results = await sync.execute({ trigger: 'cron' });
    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.error).toContain('Nenhum provider');
  });
});

describe('integracao sync -> leitura', () => {
  it('o dado sincronizado aparece na listagem com a variacao ja calculada', async () => {
    await h.sync.execute({ trigger: 'bootstrap', force: true, codes: ['usd-brl-ptax'] });

    const list = new ListIndicatorsUseCase(
      h.indicators,
      h.observations,
      new FakeFavoriteRepository([USD, IPCA]),
      h.syncRuns,
      h.clock,
    );

    const views = await list.execute({ clientId: null });
    const usd = views.find((v) => v.indicator.code === 'usd-brl-ptax')!;

    expect(usd.latest!.refDate).toBe('2026-08-12');
    expect(usd.variation!.percent!.toFixed(4)).toBe('0.6903');
    expect(usd.lastSyncedAt).not.toBeNull();
  });
});
