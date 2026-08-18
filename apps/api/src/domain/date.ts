/**
 * Normalizacao de datas.
 *
 * Cada fonte publica usa um formato diferente - inclusive duas APIs do MESMO
 * Banco Central:
 *
 *   BCB SGS    -> "18/08/2026"                    (dd/MM/yyyy)
 *   BCB PTAX   -> "2026-08-12 13:09:28.609891"    (timestamp, precisa truncar)
 *   FRED       -> "2026-08-12"                    (ISO)
 *
 * Internamente so existe UM formato: `YYYY-MM-DD`, sem hora e sem timezone.
 * Uma observacao economica e um DIA de referencia, nao um instante; carregar
 * timezone junto so cria oportunidade de a data "andar" um dia ao cruzar
 * fusos.
 */

export class DateParseError extends Error {
  constructor(input: string, format: string) {
    super(`Data invalida para o formato ${format}: "${input}"`);
    this.name = 'DateParseError';
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valida que ano/mes/dia formam uma data real (rejeita 2026-02-30). */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  );
}

function assemble(year: number, month: number, day: number, input: string, format: string): string {
  if (!isRealDate(year, month, day)) throw new DateParseError(input, format);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** BCB SGS: "18/08/2026" (dd/MM/yyyy) -> "2026-08-18". */
export function parseSgsDate(input: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (!m) throw new DateParseError(input, 'dd/MM/yyyy');
  return assemble(Number(m[3]), Number(m[2]), Number(m[1]), input, 'dd/MM/yyyy');
}

/**
 * BCB PTAX: "2026-08-12 13:09:28.609891" -> "2026-08-12".
 *
 * A hora e o momento da divulgacao do boletim de fechamento, nao um dado de
 * mercado: descartar e a leitura correta.
 */
export function parsePtaxDateTime(input: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(input.trim());
  if (!m) throw new DateParseError(input, 'yyyy-MM-dd[ HH:mm:ss]');
  return assemble(Number(m[1]), Number(m[2]), Number(m[3]), input, 'yyyy-MM-dd[ HH:mm:ss]');
}

/** FRED: "2026-08-12" (ja ISO) -> valida e devolve. */
export function parseIsoDate(input: string): string {
  const m = ISO_DATE.exec(input.trim());
  if (!m) throw new DateParseError(input, 'yyyy-MM-dd');
  return assemble(Number(m[1]), Number(m[2]), Number(m[3]), input, 'yyyy-MM-dd');
}

/**
 * Formata para a URL do PTAX (Olinda), que usa MM-DD-YYYY entre aspas simples.
 * Sim: o SGS usa dd/MM/yyyy e o PTAX usa MM-DD-YYYY, na mesma instituicao.
 */
export function toPtaxUrlDate(isoDate: string): string {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new DateParseError(isoDate, 'yyyy-MM-dd');
  return `${m[2]}-${m[3]}-${m[1]}`;
}

/** Formata para a query do SGS, que usa dd/MM/yyyy. */
export function toSgsUrlDate(isoDate: string): string {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new DateParseError(isoDate, 'yyyy-MM-dd');
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Data de hoje em UTC, no formato ISO. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Soma (ou subtrai, com valor negativo) dias a uma data ISO. */
export function addDays(isoDate: string, days: number): string {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new DateParseError(isoDate, 'yyyy-MM-dd');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Subtrai anos de uma data ISO (usado para calcular a janela de backfill). */
export function subtractYears(isoDate: string, years: number): string {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new DateParseError(isoDate, 'yyyy-MM-dd');
  const year = Number(m[1]) - years;
  const month = Number(m[2]);
  const day = Number(m[3]);
  // 29/02 menos 1 ano nao existe: cai para 28/02.
  const safeDay = isRealDate(year, month, day) ? day : 28;
  return assemble(year, month, safeDay, isoDate, 'yyyy-MM-dd');
}

/** Compara duas datas ISO. Ordenacao lexicografica ja e cronologica no ISO. */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
