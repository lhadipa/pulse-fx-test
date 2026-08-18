import { ProviderError } from '../../domain/errors.js';

/**
 * Cliente HTTP para as fontes publicas.
 *
 * BCB e FRED sao servicos gratuitos, sem SLA e ocasionalmente lentos. As tres
 * defesas aqui sao o que impede uma instabilidade deles de virar uma
 * instabilidade nossa:
 *
 *   timeout    uma requisicao pendurada nao pode segurar o worker para sempre;
 *   retry      so em falha transitoria (5xx, rede, timeout). Nunca em 4xx:
 *              repetir uma chamada malformada ou sem API key so gera carga
 *              inutil na fonte e atrasa a descoberta do erro real;
 *   backoff    exponencial com jitter, para nao sincronizar as retentativas
 *              de varios indicadores num mesmo instante.
 */

export interface HttpClientOptions {
  timeoutMs: number;
  maxRetries: number;
  /** Injetavel para tornar o teste de retry instantaneo. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export class HttpClient {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly provider: string,
    private readonly options: HttpClientOptions,
  ) {
    this.sleep = options.sleep ?? defaultSleep;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** Espera de backoff da tentativa `attempt` (1-based), com jitter. */
  private backoffMs(attempt: number): number {
    const base = Math.min(2 ** (attempt - 1) * 250, 4_000);
    return base + Math.floor(Math.random() * 250);
  }

  async getJson<T>(url: string): Promise<T> {
    const { maxRetries, timeoutMs } = this.options;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'pulse-fx/1.0' },
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          const error = new ProviderError(
            this.provider,
            `HTTP ${response.status} ao consultar a fonte: ${body.slice(0, 200)}`,
          );

          // 4xx nao se resolve repetindo: falha imediatamente.
          if (!isRetryableStatus(response.status)) throw error;
          lastError = error;
        } else {
          return (await response.json()) as T;
        }
      } catch (error) {
        if (error instanceof ProviderError && !lastError) throw error;
        lastError =
          error instanceof Error
            ? error
            : new ProviderError(this.provider, 'falha desconhecida na requisicao');
      } finally {
        clearTimeout(timer);
      }

      if (attempt <= maxRetries) {
        await this.sleep(this.backoffMs(attempt));
      }
    }

    throw new ProviderError(
      this.provider,
      `falhou apos ${maxRetries + 1} tentativa(s): ${lastError?.message ?? 'sem detalhes'}`,
      lastError,
    );
  }
}
