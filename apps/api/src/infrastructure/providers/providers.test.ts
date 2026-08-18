import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from './http-client.js';
import { BcbSgsProvider } from './bcb-sgs.provider.js';
import { BcbPtaxProvider } from './bcb-ptax.provider.js';
import { FredProvider } from './fred.provider.js';
import { ProviderError } from '../../domain/errors.js';
import type { Indicator } from '../../domain/types.js';

/**
 * Nenhum teste aqui toca a rede: `fetch` e injetado. Os payloads sao copias
 * fieis de respostas reais das APIs, capturadas em 18/08/2026.
 */

function makeIndicator(overrides: Partial<Indicator> = {}): Indicator {
  return {
    id: 1,
    code: 'test',
    source: 'BCB_SGS',
    externalId: '1',
    name: 'Test',
    shortName: 'Test',
    unit: 'BRL',
    frequency: 'DAILY',
    variationLag: 1,
    precision: 4,
    rationale: '',
    limitations: '',
    sourceUrl: 'https://example.org',
    backfillYears: 5,
    active: true,
    ...overrides,
  };
}

/** Resposta HTTP falsa, no formato que o `fetch` global devolve. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const noSleep = async (): Promise<void> => undefined;

describe('HttpClient', () => {
  it('devolve o JSON quando a fonte responde 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new HttpClient('TEST', { timeoutMs: 100, maxRetries: 2, sleep: noSleep, fetchImpl });

    await expect(client.getJson('https://example.org')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('repete em 500 e devolve o resultado quando a fonte se recupera', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new HttpClient('TEST', { timeoutMs: 100, maxRetries: 2, sleep: noSleep, fetchImpl });

    await expect(client.getJson('https://example.org')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('NAO repete em 400: repetir requisicao malformada so gera carga inutil', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad request' }, 400));
    const client = new HttpClient('TEST', { timeoutMs: 100, maxRetries: 3, sleep: noSleep, fetchImpl });

    await expect(client.getJson('https://example.org')).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('desiste apos esgotar as tentativas e informa quantas foram', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const client = new HttpClient('TEST', { timeoutMs: 100, maxRetries: 2, sleep: noSleep, fetchImpl });

    await expect(client.getJson('https://example.org')).rejects.toThrow(/3 tentativa/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('BcbSgsProvider', () => {
  const indicator = makeIndicator({ externalId: '1' });

  it('monta a URL com datas em dd/MM/yyyy', () => {
    const provider = new BcbSgsProvider(
      new HttpClient('BCB_SGS', { timeoutMs: 100, maxRetries: 0, sleep: noSleep }),
    );
    const url = provider.buildUrl('433', '2026-01-05', '2026-08-18');

    expect(url).toContain('bcdata.sgs.433/dados');
    expect(url).toContain('dataInicial=05%2F01%2F2026');
    expect(url).toContain('dataFinal=18%2F08%2F2026');
  });

  it('converte a resposta real preservando precisao do valor em string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        { data: '14/08/2026', valor: '5.2236' },
        { data: '17/08/2026', valor: '5.2014' },
        { data: '18/08/2026', valor: '5.2043' },
      ]),
    );
    const provider = new BcbSgsProvider(
      new HttpClient('BCB_SGS', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    const result = await provider.fetchObservations(indicator, '2026-08-14', '2026-08-18');

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ refDate: '2026-08-14' });
    expect(result[0]!.value.toString()).toBe('5.2236');
    expect(result[2]!.refDate).toBe('2026-08-18');
  });

  it('preserva casas decimais extras sem arredondar (serie 21619 do euro)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ data: '18/08/2026', valor: '6.0271000' }]));
    const provider = new BcbSgsProvider(
      new HttpClient('BCB_SGS', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    const result = await provider.fetchObservations(indicator, '2026-08-18', '2026-08-18');
    expect(result[0]!.value.toFixed(4)).toBe('6.0271');
  });

  it('devolve lista vazia quando a serie nao tem dado no intervalo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const provider = new BcbSgsProvider(
      new HttpClient('BCB_SGS', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    await expect(provider.fetchObservations(indicator, '2026-08-15', '2026-08-16')).resolves.toEqual(
      [],
    );
  });

  it('descarta linha corrompida sem derrubar a sincronizacao inteira', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        { data: '17/08/2026', valor: '5.2014' },
        { data: '18/08/2026', valor: 'n/d' },
      ]),
    );
    const provider = new BcbSgsProvider(
      new HttpClient('BCB_SGS', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    const result = await provider.fetchObservations(indicator, '2026-08-17', '2026-08-18');
    expect(result).toHaveLength(1);
    expect(result[0]!.refDate).toBe('2026-08-17');
  });

  it('rejeita resposta que nao e array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ erro: 'x' }));
    const provider = new BcbSgsProvider(
      new HttpClient('BCB_SGS', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    await expect(
      provider.fetchObservations(indicator, '2026-08-17', '2026-08-18'),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('BcbPtaxProvider', () => {
  const indicator = makeIndicator({ source: 'BCB_PTAX', externalId: 'CotacaoDolarPeriodo' });

  it('monta a URL com datas em MM-DD-YYYY entre aspas simples', () => {
    const provider = new BcbPtaxProvider(
      new HttpClient('BCB_PTAX', { timeoutMs: 100, maxRetries: 0, sleep: noSleep }),
    );
    const url = provider.buildUrl('2026-08-10', '2026-08-18');

    // '08-10-2026' url-encoded: %2708-10-2026%27
    expect(url).toContain('%2708-10-2026%27');
    expect(url).toContain('%2708-18-2026%27');
  });

  it('trunca o timestamp de divulgacao e usa a cotacao de venda', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        value: [
          {
            cotacaoCompra: 5.0957,
            cotacaoVenda: 5.0963,
            dataHoraCotacao: '2026-08-10 13:10:22.642754',
          },
          {
            cotacaoCompra: 5.1632,
            cotacaoVenda: 5.1639,
            dataHoraCotacao: '2026-08-12 13:09:28.609891',
          },
        ],
      }),
    );
    const provider = new BcbPtaxProvider(
      new HttpClient('BCB_PTAX', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    const result = await provider.fetchObservations(indicator, '2026-08-10', '2026-08-12');

    expect(result).toHaveLength(2);
    expect(result[0]!.refDate).toBe('2026-08-10');
    expect(result[0]!.value.toString()).toBe('5.0963');
    expect(result[1]!.refDate).toBe('2026-08-12');
  });

  it('devolve vazio em fim de semana, quando nao ha boletim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ value: [] }));
    const provider = new BcbPtaxProvider(
      new HttpClient('BCB_PTAX', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    await expect(provider.fetchObservations(indicator, '2026-08-15', '2026-08-16')).resolves.toEqual(
      [],
    );
  });

  it('rejeita resposta sem o envelope OData "value"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const provider = new BcbPtaxProvider(
      new HttpClient('BCB_PTAX', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
    );

    await expect(
      provider.fetchObservations(indicator, '2026-08-10', '2026-08-12'),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('FredProvider', () => {
  const indicator = makeIndicator({ source: 'FRED', externalId: 'DGS10' });

  it('falha com mensagem acionavel quando a API key nao foi configurada', async () => {
    const provider = new FredProvider(
      new HttpClient('FRED', { timeoutMs: 100, maxRetries: 0, sleep: noSleep }),
      '',
    );

    await expect(provider.fetchObservations(indicator, '2026-08-01', '2026-08-18')).rejects.toThrow(
      /FRED_API_KEY/,
    );
  });

  it('descarta o marcador "." de observacao ausente (feriado americano)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 4,
        observations: [
          { date: '2026-08-12', value: '4.28' },
          { date: '2026-08-13', value: '.' },
          { date: '2026-08-14', value: '4.31' },
          { date: '2026-08-17', value: '' },
        ],
      }),
    );
    const provider = new FredProvider(
      new HttpClient('FRED', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
      'fake-key',
    );

    const result = await provider.fetchObservations(indicator, '2026-08-12', '2026-08-17');

    expect(result).toHaveLength(2);
    expect(result.map((o) => o.refDate)).toEqual(['2026-08-12', '2026-08-14']);
  });

  it('pagina ate coletar todas as observacoes anunciadas em count', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ count: 3, observations: [{ date: '2026-08-12', value: '1' }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ count: 3, observations: [{ date: '2026-08-13', value: '2' }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ count: 3, observations: [{ date: '2026-08-14', value: '3' }] }),
      );
    const provider = new FredProvider(
      new HttpClient('FRED', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
      'fake-key',
    );

    const result = await provider.fetchObservations(indicator, '2026-08-12', '2026-08-14');

    expect(result).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('inclui a api key e a janela de datas na URL', () => {
    const provider = new FredProvider(
      new HttpClient('FRED', { timeoutMs: 100, maxRetries: 0, sleep: noSleep }),
      'secret-key',
    );
    const url = provider.buildUrl('DGS10', '2026-01-01', '2026-08-18');

    expect(url).toContain('series_id=DGS10');
    expect(url).toContain('api_key=secret-key');
    expect(url).toContain('observation_start=2026-01-01');
    expect(url).toContain('observation_end=2026-08-18');
  });

  it('rejeita resposta sem o campo observations', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error_message: 'bad' }));
    const provider = new FredProvider(
      new HttpClient('FRED', { timeoutMs: 100, maxRetries: 0, sleep: noSleep, fetchImpl }),
      'fake-key',
    );

    await expect(
      provider.fetchObservations(indicator, '2026-08-12', '2026-08-14'),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
