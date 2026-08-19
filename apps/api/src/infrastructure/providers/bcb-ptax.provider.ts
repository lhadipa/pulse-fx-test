import type { SeriesProvider } from '../../application/ports.js';
import { ProviderError } from '../../domain/errors.js';
import { parsePtaxDateTime, toPtaxUrlDate } from '../../domain/date.js';
import type { Indicator, Observation } from '../../domain/types.js';
import type { HttpClient } from './http-client.js';
import { parseDecimalOrNull } from './parse-decimal.js';

/**
 * BCB - PTAX via Olinda (OData).
 *
 * Endpoint (verificado):
 *   https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/
 *     CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)
 *     ?@dataInicial='08-10-2026'&@dataFinalCotacao='08-18-2026'&$format=json
 *
 * Resposta:
 *   { "value": [{ "cotacaoCompra": 5.09570,
 *                 "cotacaoVenda":  5.09630,
 *                 "dataHoraCotacao": "2026-08-10 13:10:22.642754" }] }
 *
 * Particularidades:
 *  - as datas na URL usam MM-DD-YYYY e vao ENTRE ASPAS SIMPLES, diferente do
 *    dd/MM/yyyy do SGS. Mesma instituicao, formatos distintos;
 *  - `dataHoraCotacao` e o instante de divulgacao do boletim, nao um dado de
 *    mercado: truncamos para o dia de referencia;
 *  - persistimos a cotacao de VENDA, que e a referencia usual de contrato.
 *  - a Olinda pagina em 10.000 registros; a janela maxima que usamos (5 anos
 *    de dias uteis, ~1.250 linhas) fica com folga abaixo do limite.
 */

const BASE_URL =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)';

interface PtaxRow {
  cotacaoCompra: number | string;
  cotacaoVenda: number | string;
  dataHoraCotacao: string;
}

interface PtaxResponse {
  value?: PtaxRow[];
}

export class BcbPtaxProvider implements SeriesProvider {
  readonly source = 'BCB_PTAX' as const;

  constructor(private readonly http: HttpClient) {}

  buildUrl(from: string, to: string): string {
    const params = new URLSearchParams({
      '@dataInicial': `'${toPtaxUrlDate(from)}'`,
      '@dataFinalCotacao': `'${toPtaxUrlDate(to)}'`,
      $format: 'json',
      $select: 'cotacaoCompra,cotacaoVenda,dataHoraCotacao',
    });
    return `${BASE_URL}?${params.toString()}`;
  }

  async fetchObservations(_indicator: Indicator, from: string, to: string): Promise<Observation[]> {
    const url = this.buildUrl(from, to);
    const payload = await this.http.getJson<PtaxResponse>(url);

    if (!payload || !Array.isArray(payload.value)) {
      throw new ProviderError('BCB_PTAX', 'resposta inesperada: campo "value" ausente ou invalido');
    }

    // A Olinda devolve VARIOS boletins para o mesmo dia (os intermediarios e o
    // de fechamento). Truncar `dataHoraCotacao` para o dia colapsa todos no
    // mesmo refDate, e o upsert em lote quebraria com "ON CONFLICT DO UPDATE
    // command cannot affect row a second time". Ficamos com o boletim de maior
    // dataHoraCotacao do dia, que e o de fechamento - a PTAX oficial.
    const byRefDate = new Map<string, { stamp: string; obs: Observation }>();

    for (const row of payload.value) {
      if (!row?.dataHoraCotacao) continue;

      const value = parseDecimalOrNull(row.cotacaoVenda);
      if (!value) continue;

      const refDate = parsePtaxDateTime(row.dataHoraCotacao);
      const stamp = row.dataHoraCotacao.trim();
      const current = byRefDate.get(refDate);

      // O formato "yyyy-MM-dd HH:mm:ss.ffffff" ordena corretamente como string.
      if (!current || stamp > current.stamp) {
        byRefDate.set(refDate, { stamp, obs: { refDate, value } });
      }
    }

    return [...byRefDate.values()].map((entry) => entry.obs);
  }
}
