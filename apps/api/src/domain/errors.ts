/** Erros de dominio. A camada HTTP os traduz para status codes. */

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class IndicatorNotFoundError extends DomainError {
  constructor(code: string) {
    super(`Indicador nao encontrado: ${code}`, 'INDICATOR_NOT_FOUND', 404);
  }
}

export class InvalidClientIdError extends DomainError {
  constructor() {
    super(
      'Header x-client-id ausente ou nao e um UUID valido. O frontend gera um por navegador.',
      'INVALID_CLIENT_ID',
      400,
    );
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Credencial de administrador invalida ou ausente.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

/** Falha ao falar com uma fonte externa (BCB / FRED). */
export class ProviderError extends DomainError {
  constructor(
    readonly provider: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`, 'PROVIDER_ERROR', 502);
  }
}
