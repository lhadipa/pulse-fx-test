import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CLIENT_ID_HEADER, historyWindowSchema } from '@pulse-fx/shared';
import { InvalidClientIdError, UnauthorizedError } from '../../domain/errors.js';
import type { HistoryWindow } from '../../application/get-series.usecase.js';
import { toIndicatorDetailDto, toIndicatorSummaryDto, toObservationDto } from './mappers.js';
import type { AppContainer } from '../../container.js';

const codeParamsSchema = z.object({ code: z.string().min(1).max(64) });
const listQuerySchema = z.object({
  favorites: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
const seriesQuerySchema = z.object({ window: historyWindowSchema.optional() });
const syncBodySchema = z.object({
  codes: z.array(z.string()).optional(),
  force: z.boolean().optional().default(false),
});

/**
 * O client id identifica o dono dos favoritos. Exigimos um UUID valido: um
 * valor livre viraria chave de particao arbitraria na tabela e permitiria a
 * qualquer um enumerar listas alheias por tentativa.
 */
function readClientId(request: FastifyRequest, { required }: { required: boolean }): string | null {
  const raw = request.headers[CLIENT_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) {
    if (required) throw new InvalidClientIdError();
    return null;
  }

  if (!z.string().uuid().safeParse(value).success) throw new InvalidClientIdError();
  return value;
}

function assertAdmin(request: FastifyRequest, expectedToken: string): void {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();

  const token = header.slice('Bearer '.length);
  // Comparacao de tamanho antes do conteudo evita ruido; para um MVP com um
  // unico token estatico isso e suficiente.
  if (token.length !== expectedToken.length || token !== expectedToken) {
    throw new UnauthorizedError();
  }
}

export async function registerRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    try {
      await container.pool.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Banco de dados indisponivel.' },
      });
    }
  });

  app.get('/api/indicators', async (request) => {
    const { favorites } = listQuerySchema.parse(request.query);
    const clientId = readClientId(request, { required: false });

    const views = await container.listIndicators.execute({
      clientId,
      onlyFavorites: favorites,
    });

    return { indicators: views.map(toIndicatorSummaryDto) };
  });

  app.get('/api/indicators/:code', async (request) => {
    const { code } = codeParamsSchema.parse(request.params);
    const clientId = readClientId(request, { required: false });

    return toIndicatorDetailDto(await container.listIndicators.executeOne(code, clientId));
  });

  app.get('/api/indicators/:code/observations', async (request) => {
    const { code } = codeParamsSchema.parse(request.params);
    const { window } = seriesQuerySchema.parse(request.query);

    const result = await container.getSeries.execute(code, window as HistoryWindow | undefined);

    return {
      code: result.indicator.code,
      window: result.window,
      from: result.from,
      to: result.to,
      count: result.observations.length,
      observations: result.observations.map(toObservationDto),
    };
  });

  app.get('/api/favorites', async (request) => {
    const clientId = readClientId(request, { required: true })!;
    return { codes: await container.toggleFavorite.list(clientId) };
  });

  app.put('/api/favorites/:code', async (request, reply) => {
    const { code } = codeParamsSchema.parse(request.params);
    const clientId = readClientId(request, { required: true })!;

    await container.toggleFavorite.add(clientId, code);
    return reply.status(204).send();
  });

  app.delete('/api/favorites/:code', async (request, reply) => {
    const { code } = codeParamsSchema.parse(request.params);
    const clientId = readClientId(request, { required: true })!;

    await container.toggleFavorite.remove(clientId, code);
    return reply.status(204).send();
  });

  /**
   * Endpoint administrativo de sincronizacao.
   *
   * Protegido por bearer token porque e a unica rota capaz de gerar trafego
   * para as APIs externas sob demanda. `force` ignora o TTL e existe para a
   * demonstracao do fluxo.
   */
  app.post('/api/admin/sync', async (request) => {
    assertAdmin(request, container.config.ADMIN_TOKEN);
    const body = syncBodySchema.parse(request.body ?? {});

    const results = await container.syncIndicators.execute({
      trigger: 'admin',
      codes: body.codes,
      force: body.force,
    });

    return { results };
  });
}
