import { useState } from 'react';
import { IndicatorCard } from '../components/IndicatorCard.js';
import { CardSkeleton, StateMessage } from '../components/StateMessage.js';
import { useIndicators, useToggleFavorite } from '../hooks/useIndicators.js';

export function Dashboard(): JSX.Element {
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const { data, isPending, isError, error, refetch } = useIndicators(onlyFavorites);
  const toggleFavorite = useToggleFavorite(onlyFavorites);

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Painel</h1>
          <p className="text-sm text-slate-400">
            Cambio e indicadores macro do Brasil e dos Estados Unidos.
          </p>
        </div>

        <div className="flex rounded-lg border border-slate-700 p-1" role="group" aria-label="Filtro">
          <button
            type="button"
            onClick={() => setOnlyFavorites(false)}
            aria-pressed={!onlyFavorites}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              !onlyFavorites ? 'bg-sky-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setOnlyFavorites(true)}
            aria-pressed={onlyFavorites}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              onlyFavorites ? 'bg-sky-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            Meus indicadores
          </button>
        </div>
      </header>

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {isError && (
        <StateMessage
          title="Nao foi possivel carregar os indicadores"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.indicators.length === 0 && (
        <StateMessage
          title={onlyFavorites ? 'Voce ainda nao marcou indicadores' : 'Nenhum indicador disponivel'}
          description={
            onlyFavorites
              ? 'Use a estrela nos cards da aba "Todos" para montar sua lista.'
              : 'A primeira sincronizacao pode levar alguns instantes apos subir o ambiente.'
          }
        />
      )}

      {data && data.indicators.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.indicators.map((indicator) => (
            <IndicatorCard
              key={indicator.code}
              indicator={indicator}
              onToggleFavorite={(code, isFavorite) => toggleFavorite.mutate({ code, isFavorite })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
