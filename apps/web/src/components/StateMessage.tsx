interface Props {
  title: string;
  description?: string;
  onRetry?: () => void;
}

/** Estados de erro e vazio. O caminho triste tambem precisa de desenho. */
export function StateMessage({ title, description, onRetry }: Props): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/40 p-8 text-center">
      <p className="font-medium text-slate-200">{title}</p>
      {description && <p className="max-w-md text-sm text-slate-400">{description}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

/** Esqueleto de carregamento, para o layout nao pular quando o dado chega. */
export function CardSkeleton(): JSX.Element {
  return (
    <div
      className="h-40 animate-pulse rounded-xl border border-slate-700 bg-slate-800/40"
      aria-hidden="true"
    />
  );
}
