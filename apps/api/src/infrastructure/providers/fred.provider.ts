import type { SeriesProvider } from '../../application/ports.js';
import { ProviderError } from '../../domain/errors.js';
import { parseIsoDate } from '../../domain/date.js';
import type { Indicator, Observation } from '../../domain/types.js';
import type { HttpClient } from './http-client.js';
import { parseDecimalOrNull } from './parse-decimal.js';

/**
 * FRED - Federal Reserve Economic Data (St. Louis Fed).
 *
 * Endpoint (verificado):
 *   https://api.stlouisfed.org/fred/series/observations
 *     ?series_id=DGS10&api_key=...&file_type=json
 *     &observation_start=YYYY-MM-DD&observation_end=YYYY-MM-DD
 *
 * Resposta:
 *   { "observations": [{ "date": "2026-08-12", "value": "4.28" }] }
 *
 * Particularidades:
 *  - exige API key. Sem ela a resposta e HTTP 400 com
 *    "Variable api_key is not set" (confirmado). Falhamos no boot com uma
 *    mensagem clara em vez de deixar o erro aparecer so na primeira sync;
 *  - VALOR AUSENTE E O CARACTERE ".", nao null nem string vazia. Feriado
 *    americano em serie diaria vem assim. Converter isso com Number() daria
 *    NaN e envenenaria a serie inteira - filtramos explicitamente;
 *  - a paginacao e por limit/offset, com teto de 100.000 observacoes por
 *    resposta. Nossas janelas ficam muito abaixo disso, mas o loop de
 *    paginacao esta implementado para nao truncar dado em silencio.
 */

const BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const PAGE_LIMIT = 100_000;

/** Marcador de observacao ausente usado pelo FRED. */
const MISSING_VALUE = '.';

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations?: FredObservation[];
  count?: number;
  offset?: number;
  limit?: number;
}

export class FredProvider implements SeriesProvider {
  readonly source = 'FRED' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string,
  ) {}

  buildUrl(seriesId: string, from: string, to: string, offset = 0): string {
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: this.apiKey,
      file_type: 'json',
      observation_start: from,
      observation_end: to,
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    return `${BASE_URL}?${params.toString()}`;
  }

  async fetchObservations(indicator: Indicator, from: string, to: string): Promise<Observation[]> {
    if (!this.apiKey) {
      throw new ProviderError(
        'FRED',
        'FRED_API_KEY nao configurada. Registre uma chave gratuita em ' +
          'https://fredaccount.stlouisfed.org/apikeys e defina a variavel de ambiente.',
      );
    }

    const observations: Observation[] = [];
    let offset = 0;

    for (;;) {
      const url = this.buildUrl(indicator.externalId, from, to, offset);
      const payload = await this.http.getJson<FredResponse>(url);

      if (!payload || !Array.isArray(payload.observations)) {
        throw new ProviderError(
          'FRED',
          `resposta inesperada para a serie ${indicator.externalId}: campo "observations" ausente`,
        );
      }

      for (const row of payload.observations) {
        if (!row?.date) continue;

        // Feriado americano ou dado nao publicado: o FRED manda ".".
        if (String(row.value ?? '').trim() === MISSING_VALUE) continue;

        const value = parseDecimalOrNull(row.value);
        if (!value) continue;

        observations.push({ refDate: parseIsoDate(row.date), value });
      }

      const returned = payload.observations.length;
      const total = payload.count ?? returned;
      offset += returned;

      if (returned === 0 || offset >= total) break;
    }

    return observations;
  }
}
