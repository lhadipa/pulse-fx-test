import type { SeriesProvider } from '../../application/ports.js';
import { ProviderError } from '../../domain/errors.js';
import { parseSgsDate, toSgsUrlDate } from '../../domain/date.js';
import type { Indicator, Observation } from '../../domain/types.js';
import type { HttpClient } from './http-client.js';
import { parseDecimalOrNull } from './parse-decimal.js';

/**
 * BCB - Sistema Gerenciador de Series Temporais (SGS).
 *
 * Endpoint (verificado):
 *   https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados
 *     ?formato=json&dataInicial=dd/MM/yyyy&dataFinal=dd/MM/yyyy
 *
 * Resposta:
 *   [{ "data": "18/08/2026", "valor": "5.2043" }]
 *
 * Dois detalhes que o codigo precisa respeitar:
 *  - `valor` vem como STRING. Converter com Number() perderia precisao; vai
 *    direto para Decimal.
 *  - as datas usam dd/MM/yyyy, ao contrario da API PTAX do mesmo BCB.
 */

const BASE_URL = 'https://api.bcb.gov.br/dados/serie';

interface SgsRow {
  data: string;
  valor: string;
}

export class BcbSgsProvider implements SeriesProvider {
  readonly source = 'BCB_SGS' as const;

  constructor(private readonly http: HttpClient) {}

  buildUrl(seriesId: string, from: string, to: string): string {
    const params = new URLSearchParams({
      formato: 'json',
      dataInicial: toSgsUrlDate(from),
      dataFinal: toSgsUrlDate(to),
    });
    return `${BASE_URL}/bcdata.sgs.${seriesId}/dados?${params.toString()}`;
  }

  async fetchObservations(indicator: Indicator, from: string, to: string): Promise<Observation[]> {
    const url = this.buildUrl(indicator.externalId, from, to);
    const payload = await this.http.getJson<SgsRow[]>(url);

    // O SGS devolve 404 para intervalo sem dado em algumas series e [] em
    // outras. O 404 ja virou ProviderError no HttpClient; aqui tratamos a
    // resposta vazia ou inesperada.
    if (!Array.isArray(payload)) {
      throw new ProviderError(
        'BCB_SGS',
        `resposta inesperada para a serie ${indicator.externalId}: era esperado um array`,
      );
    }

    const observations: Observation[] = [];

    for (const row of payload) {
      if (!row?.data) continue;

      // Uma linha corrompida ("n/d", "-", vazio) nao pode derrubar a
      // sincronizacao inteira da serie.
      const value = parseDecimalOrNull(row.valor);
      if (!value) continue;

      observations.push({ refDate: parseSgsDate(row.data), value });
    }

    return observations;
  }
}
