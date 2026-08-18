import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { AppContainer } from '../../container.js';
import { registerErrorHandler } from './error-handler.js';
import { registerRoutes } from './routes.js';

/**
 * Monta a aplicacao Fastify sem escutar em porta nenhuma.
 *
 * Separar "montar" de "escutar" e o que permite aos testes usarem
 * `app.inject()`: as rotas rodam de verdade, com o error handler e a
 * validacao reais, sem abrir socket nem competir por porta.
 */
export async function buildApp(container: AppContainer): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: container.config.LOG_LEVEL,
      // Em desenvolvimento o log legivel vale mais que o JSON estruturado.
      ...(container.config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
  });

  await app.register(cors, {
    origin: container.config.CORS_ORIGIN === '*' ? true : container.config.CORS_ORIGIN.split(','),
    allowedHeaders: ['Content-Type', 'Authorization', 'x-client-id'],
  });

  // Protege a NOSSA API. As fontes externas ja estao protegidas pelo TTL e
  // pelo fato de a leitura nunca sair do Postgres.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Pulse FX API',
        description:
          'Cambio (BRL) e indicadores macro a partir de fontes publicas (BCB e FRED). ' +
          'Conteudo educacional: nao constitui recomendacao de investimento.',
        version: '1.0.0',
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerErrorHandler(app);
  await registerRoutes(app, container);

  return app;
}
