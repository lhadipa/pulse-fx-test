import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors.js';

/**
 * Tradutor unico de erro -> resposta HTTP.
 *
 * Centralizar aqui e o que permite que nenhum handler de rota tenha try/catch:
 * a rota levanta um erro de dominio e esta funcao decide o status. Detalhes
 * internos (stack, mensagem do driver do Postgres) nunca vazam para o cliente
 * - eles vao para o log, com o requestId para correlacao.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Rota nao encontrada: ${request.method} ${request.url}`,
      },
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.info({ issues: error.issues }, 'requisicao invalida');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parametros da requisicao invalidos.',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof DomainError) {
      // 5xx de dominio (ex.: fonte externa fora do ar) merecem log de erro;
      // 4xx sao comportamento esperado do cliente.
      const log = error.httpStatus >= 500 ? request.log.error : request.log.info;
      log.call(request.log, { err: error.message, code: error.code }, 'erro de dominio');

      return reply.status(error.httpStatus).send({
        error: { code: error.code, message: error.message },
      });
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: 'Muitas requisicoes. Tente novamente em instantes.' },
      });
    }

    request.log.error({ err: error }, 'erro nao tratado');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' },
    });
  });
}
