import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { indicatorListResponseSchema, indicatorDetailSchema, seriesResponseSchema } from '@pulse-fx/shared';
import { buildApp } from './app.js';
import { loadConfig } from '../../infrastructure/config/env.js';
import { GetSeriesUseCase } from '../../application/get-series.usecase.js';
import { ListIndicatorsUseCase } from '../../application/list-indicators.usecase.js';
import { ToggleFavoriteUseCase } from '../../application/toggle-favorite.usecase.js';
import { SyncIndicatorsUseCase } from '../../application/sync-indicators.usecase.js';
import type { AppContainer } from '../../container.js';
import type { SeriesProvider } from '../../application/ports.js';
import type { Indicator } from '../../domain/types.js';
import {
  FakeClock,
  FakeFavoriteRepository,
  FakeIndicatorRepository,
  FakeObservationRepository,
  FakeSyncRunRepository,
  makeIndicator,
  obs,
} from '../../test/fakes.js';

/**
 * Testes de rota com `app.inject()`: exercitam a aplicacao Fastify real -
 * roteamento, validacao, serializacao e error handler - sem abrir socket e
 * sem Postgres.
 */

const CLIENT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const ADMIN_TOKEN = 'test-admin-token';
const TODAY = new Date('2026-08-18T12:00:00Z');

const USD = makeIndicator({ id: 1, code: 'usd-brl-ptax', frequency: 'DAILY' });
const IPCA = makeIndicator({
  id: 2,
  code: 'ipca-monthly',
  source: 'BCB_SGS',
  externalId: '433',
  name: 'IPCA - variacao mensal',
  shortName: 'IPCA',
  unit: 'PERCENT',
  frequency: 'MONTHLY',
  precision: 2,
});
const INACTIVE = makeIndicator({ id: 3, code: 'retired-series', active: false });

function buildTestContainer(): { container: AppContainer; observations: FakeObservationRepository } {
  const indicators = [USD, IPCA, INACTIVE];
  const clock = new FakeClock(TODAY);

  const indicatorRepo = new FakeIndicatorRepository(indicators);
  const observationRepo = new FakeObservationRepository();
  const favoriteRepo = new FakeFavoriteRepository(indicators);
  const syncRunRepo = new FakeSyncRunRepository(clock);

  // Dados reais do PTAX e do IPCA.
  observationRepo.seed(USD.id, [
    obs('2026-08-11', '5.12850'),
    obs('2026-08-12', '5.16390'),
  ]);
  observationRepo.seed(IPCA.id, [
    obs('2026-05-01', '0.58'),
    obs('2026-06-01', '0.16'),
    obs('2026-07-01', '0.07'),
  ]);

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused',
    ADMIN_TOKEN,
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  const container: AppContainer = {
    config,
    pool: { query: async () => ({ rows: [{ '?column?': 1 }] }) } as unknown as AppContainer['pool'],
    listIndicators: new ListIndicatorsUseCase(
      indicatorRepo,
      observationRepo,
      favoriteRepo,
      syncRunRepo,
      clock,
    ),
    getSeries: new GetSeriesUseCase(indicatorRepo, observationRepo, clock),
    toggleFavorite: new ToggleFavoriteUseCase(indicatorRepo, favoriteRepo),
    syncIndicators: new SyncIndicatorsUseCase(
      indicatorRepo,
      observationRepo,
      syncRunRepo,
      new Map<Indicator['source'], SeriesProvider>(),
      clock,
      30,
      5,
    ),
    close: async () => undefined,
  };

  return { container, observations: observationRepo };
}

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp(buildTestContainer().container);
});

afterEach(async () => {
  await app.close();
});

describe('GET /health e /ready', () => {
  it('health responde 200 sem tocar no banco', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('ready responde 200 quando o banco aceita consulta', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
  });
});

describe('GET /api/indicators', () => {
  it('devolve payload que satisfaz o contrato compartilhado', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });

    expect(response.statusCode).toBe(200);
    const parsed = indicatorListResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
  });

  it('nao lista indicadores inativos', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });
    const codes = response.json().indicators.map((i: { code: string }) => i.code);

    expect(codes).toContain('usd-brl-ptax');
    expect(codes).not.toContain('retired-series');
  });

  it('expoe o denominador da variacao explicitamente', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });
    const usd = response.json().indicators.find((i: { code: string }) => i.code === 'usd-brl-ptax');

    expect(usd.latest).toEqual({ refDate: '2026-08-12', value: '5.1639' });
    expect(usd.previous).toEqual({ refDate: '2026-08-11', value: '5.1285' });
    expect(usd.variation.percent).toBe('0.6903');
    expect(usd.variation.lagUnit).toBe('business_day');
  });

  it('serializa valores como string para nao perder precisao', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });
    const usd = response.json().indicators.find((i: { code: string }) => i.code === 'usd-brl-ptax');

    expect(typeof usd.latest.value).toBe('string');
    expect(typeof usd.variation.percent).toBe('string');
  });

  it('aplica a politica mensal na serie mensal, e nao a diaria', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });
    const ipca = response.json().indicators.find((i: { code: string }) => i.code === 'ipca-monthly');

    expect(ipca.variation.lagUnit).toBe('month');
    expect(ipca.previous.refDate).toBe('2026-06-01');
  });

  it('filtra por favoritos quando favorites=true', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/favorites/ipca-monthly',
      headers: { 'x-client-id': CLIENT_ID },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/indicators?favorites=true',
      headers: { 'x-client-id': CLIENT_ID },
    });

    const codes = response.json().indicators.map((i: { code: string }) => i.code);
    expect(codes).toEqual(['ipca-monthly']);
  });

  it('marca isFavorite conforme o client id enviado', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/indicators' });
    const usd = anonymous.json().indicators.find((i: { code: string }) => i.code === 'usd-brl-ptax');
    expect(usd.isFavorite).toBe(false);
  });
});

describe('GET /api/indicators/:code', () => {
  it('devolve o detalhe com rationale e limitations', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators/usd-brl-ptax' });

    expect(response.statusCode).toBe(200);
    expect(indicatorDetailSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json().limitations).toBeTruthy();
    expect(response.json().defaultWindow).toBe('90d');
  });

  it('devolve 404 para codigo inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators/nao-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('INDICATOR_NOT_FOUND');
  });

  it('trata indicador inativo como inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators/retired-series' });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/indicators/:code/observations', () => {
  it('devolve a serie em ordem cronologica', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/indicators/usd-brl-ptax/observations?window=90d',
    });

    expect(response.statusCode).toBe(200);
    expect(seriesResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json().observations.map((o: { refDate: string }) => o.refDate)).toEqual([
      '2026-08-11',
      '2026-08-12',
    ]);
  });

  it('usa a janela default da frequencia quando nenhuma e informada', async () => {
    const daily = await app.inject({
      method: 'GET',
      url: '/api/indicators/usd-brl-ptax/observations',
    });
    const monthly = await app.inject({
      method: 'GET',
      url: '/api/indicators/ipca-monthly/observations',
    });

    expect(daily.json().window).toBe('90d');
    expect(monthly.json().window).toBe('5y');
  });

  it('rejeita janela invalida com 400 e detalhes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/indicators/usd-brl-ptax/observations?window=7d',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('favoritos', () => {
  it('exige um client id valido', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/favorites' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('INVALID_CLIENT_ID');

    const malformed = await app.inject({
      method: 'GET',
      url: '/api/favorites',
      headers: { 'x-client-id': 'nao-e-uuid' },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('persiste e remove favoritos de forma idempotente', async () => {
    const headers = { 'x-client-id': CLIENT_ID };

    const first = await app.inject({ method: 'PUT', url: '/api/favorites/usd-brl-ptax', headers });
    const again = await app.inject({ method: 'PUT', url: '/api/favorites/usd-brl-ptax', headers });
    expect(first.statusCode).toBe(204);
    expect(again.statusCode).toBe(204);

    const listed = await app.inject({ method: 'GET', url: '/api/favorites', headers });
    expect(listed.json().codes).toEqual(['usd-brl-ptax']);

    await app.inject({ method: 'DELETE', url: '/api/favorites/usd-brl-ptax', headers });
    const removedTwice = await app.inject({
      method: 'DELETE',
      url: '/api/favorites/usd-brl-ptax',
      headers,
    });
    expect(removedTwice.statusCode).toBe(204);

    const empty = await app.inject({ method: 'GET', url: '/api/favorites', headers });
    expect(empty.json().codes).toEqual([]);
  });

  it('nao permite favoritar indicador inexistente', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/favorites/nao-existe',
      headers: { 'x-client-id': CLIENT_ID },
    });
    expect(response.statusCode).toBe(404);
  });

  it('isola listas de clientes diferentes', async () => {
    const other = '11111111-2222-3333-4444-555555555555';

    await app.inject({
      method: 'PUT',
      url: '/api/favorites/usd-brl-ptax',
      headers: { 'x-client-id': CLIENT_ID },
    });

    const otherList = await app.inject({
      method: 'GET',
      url: '/api/favorites',
      headers: { 'x-client-id': other },
    });
    expect(otherList.json().codes).toEqual([]);
  });
});

describe('POST /api/admin/sync', () => {
  it('recusa requisicao sem token', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/sync', payload: {} });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('recusa token incorreto', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/sync',
      headers: { authorization: 'Bearer token-errado' },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('aceita o token correto', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/sync',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { codes: ['usd-brl-ptax'], force: true },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().results)).toBe(true);
  });
});

describe('rota inexistente', () => {
  it('devolve 404 com corpo no formato de erro da API', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nao-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ROUTE_NOT_FOUND');
  });
});
