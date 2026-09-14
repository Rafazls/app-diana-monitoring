/** Estados transversais: carregando, erro e vazio. */

export function Loading() {
  return <p className="state state--loading">Carregando…</p>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state--error">
      <p>{message}</p>
      {onRetry && (
        <button className="button" onClick={onRetry} type="button">
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="state state--empty">{message}</p>;
}
