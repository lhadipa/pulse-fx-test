import { Decimal } from 'decimal.js';

/**
 * Converte um valor cru de uma fonte externa em Decimal, ou `null` se ele nao
 * for um numero utilizavel.
 *
 * O construtor do Decimal LANCA em entrada nao numerica ("n/d", "-", "N/A"),
 * em vez de produzir NaN como o Number() faria. Sem este wrapper, uma unica
 * celula suja no meio de cinco anos de historico derrubaria a sincronizacao
 * inteira da serie - e as fontes publicas realmente publicam esse tipo de
 * marcador.
 */
export function parseDecimalOrNull(raw: unknown): Decimal | null {
  if (raw === null || raw === undefined) return null;

  const text = String(raw).trim();
  if (text === '') return null;

  try {
    const value = new Decimal(text);
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}
