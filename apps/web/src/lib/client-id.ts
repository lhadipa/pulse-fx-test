const STORAGE_KEY = 'pulse-fx:client-id';

/**
 * Identidade anonima do usuario.
 *
 * Autenticacao esta fora do escopo do MVP (briefing, secao 8), mas os
 * favoritos precisam de persistencia REAL no backend (secao 4.3). A solucao e
 * um UUID gerado no navegador e enviado em todas as requisicoes: o servidor
 * guarda a lista de verdade, no Postgres, associada a esse identificador.
 *
 * Trade-off explicito, documentado no README: a lista acompanha o NAVEGADOR,
 * nao a pessoa. Limpar o armazenamento local ou trocar de dispositivo comeca
 * uma lista nova. Resolver isso exigiria login, que o proprio briefing coloca
 * fora de escopo.
 */
export function getClientId(): string {
  // SSR / ambiente de teste sem localStorage: devolve um id efemero em vez de
  // quebrar.
  if (typeof localStorage === 'undefined') return crypto.randomUUID();

  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const created = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}
