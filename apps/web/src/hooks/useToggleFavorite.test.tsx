import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IndicatorListResponse } from '@pulse-fx/shared';
import { queryKeys, useToggleFavorite } from './useIndicators.js';
import { api } from '../lib/api.js';

/**
 * O ponto deste arquivo e o ROLLBACK.
 *
 * A atualizacao otimista deixa a estrela responder na hora, mas se a chamada
 * falhar e o estado nao voltar atras, a UI passa a mentir sobre o que esta
 * realmente persistido no servidor. Esse e o bug que estes testes impedem.
 */

const INITIAL: IndicatorListResponse = {
  indicators: [
    {
      code: 'usd-brl-ptax',
      name: 'Dolar americano PTAX (venda)',
      shortName: 'USD/BRL PTAX',
      source: 'BCB_PTAX',
      unit: 'BRL',
      frequency: 'DAILY',
      precision: 4,
      latest: { refDate: '2026-08-12', value: '5.1639' },
      previous: { refDate: '2026-08-11', value: '5.1285' },
      variation: { absolute: '0.0354', percent: '0.6903', lag: 1, lagUnit: 'business_day' },
      isFavorite: false,
      lastSyncedAt: '2026-08-18T12:00:00.000Z',
    },
  ],
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.indicators(false), INITIAL);
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

function currentFavorite(): boolean {
  return (
    queryClient.getQueryData<IndicatorListResponse>(queryKeys.indicators(false))!.indicators[0]!
      .isFavorite
  );
}

describe('useToggleFavorite', () => {
  it('marca como favorito imediatamente, antes da resposta do servidor', async () => {
    let resolveRequest: () => void = () => undefined;
    vi.spyOn(api, 'addFavorite').mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const { result } = renderHook(() => useToggleFavorite(false), { wrapper });
    result.current.mutate({ code: 'usd-brl-ptax', isFavorite: false });

    // A UI ja reflete a mudanca com a requisicao ainda pendente.
    await waitFor(() => expect(currentFavorite()).toBe(true));

    resolveRequest();
  });

  it('chama removeFavorite quando o indicador ja e favorito', async () => {
    queryClient.setQueryData<IndicatorListResponse>(queryKeys.indicators(false), {
      indicators: [{ ...INITIAL.indicators[0]!, isFavorite: true }],
    });

    const remove = vi.spyOn(api, 'removeFavorite').mockResolvedValue(undefined);
    vi.spyOn(api, 'listIndicators').mockResolvedValue(INITIAL);

    const { result } = renderHook(() => useToggleFavorite(false), { wrapper });
    result.current.mutate({ code: 'usd-brl-ptax', isFavorite: true });

    await waitFor(() => expect(remove).toHaveBeenCalledWith('usd-brl-ptax'));
  });

  it('desfaz a mudanca otimista quando a requisicao falha', async () => {
    vi.spyOn(api, 'addFavorite').mockRejectedValue(new Error('rede indisponivel'));
    vi.spyOn(api, 'listIndicators').mockResolvedValue(INITIAL);

    const { result } = renderHook(() => useToggleFavorite(false), { wrapper });
    result.current.mutate({ code: 'usd-brl-ptax', isFavorite: false });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Rollback: a estrela volta ao estado real do servidor.
    expect(currentFavorite()).toBe(false);
  });

  it('nao quebra quando o cache ainda nao foi populado', async () => {
    queryClient.clear();
    vi.spyOn(api, 'addFavorite').mockResolvedValue(undefined);
    vi.spyOn(api, 'listIndicators').mockResolvedValue(INITIAL);

    const { result } = renderHook(() => useToggleFavorite(false), { wrapper });
    result.current.mutate({ code: 'usd-brl-ptax', isFavorite: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
