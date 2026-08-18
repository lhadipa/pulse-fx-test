import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HistoryWindow, IndicatorListResponse } from '@pulse-fx/shared';
import { api } from '../lib/api.js';

export const queryKeys = {
  indicators: (onlyFavorites: boolean) => ['indicators', { onlyFavorites }] as const,
  indicator: (code: string) => ['indicator', code] as const,
  series: (code: string, window?: HistoryWindow) => ['series', code, window ?? 'default'] as const,
};

export function useIndicators(onlyFavorites: boolean) {
  return useQuery({
    queryKey: queryKeys.indicators(onlyFavorites),
    queryFn: () => api.listIndicators(onlyFavorites),
    // Os dados so mudam quando o worker sincroniza; refazer a leitura a cada
    // foco de janela seria trafego a toa.
    staleTime: 60_000,
  });
}

export function useIndicator(code: string) {
  return useQuery({
    queryKey: queryKeys.indicator(code),
    queryFn: () => api.getIndicator(code),
    staleTime: 60_000,
  });
}

export function useSeries(code: string, window?: HistoryWindow) {
  return useQuery({
    queryKey: queryKeys.series(code, window),
    queryFn: () => api.getSeries(code, window),
    staleTime: 60_000,
  });
}

/**
 * Favoritar com atualizacao otimista.
 *
 * A estrela responde na hora; se a chamada falhar, o estado anterior e
 * restaurado. Sem o rollback, um erro de rede deixaria a UI mentindo sobre o
 * que esta persistido no servidor.
 */
export function useToggleFavorite(onlyFavorites: boolean) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.indicators(onlyFavorites);

  return useMutation({
    mutationFn: ({ code, isFavorite }: { code: string; isFavorite: boolean }) =>
      isFavorite ? api.removeFavorite(code) : api.addFavorite(code),

    onMutate: async ({ code, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<IndicatorListResponse>(queryKey);

      queryClient.setQueryData<IndicatorListResponse>(queryKey, (current) =>
        current
          ? {
              indicators: current.indicators.map((indicator) =>
                indicator.code === code ? { ...indicator, isFavorite: !isFavorite } : indicator,
              ),
            }
          : current,
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['indicators'] });
    },
  });
}
