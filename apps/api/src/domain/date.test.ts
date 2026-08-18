import { describe, it, expect } from 'vitest';
import {
  DateParseError,
  addDays,
  compareIsoDates,
  parseIsoDate,
  parsePtaxDateTime,
  parseSgsDate,
  subtractYears,
  todayIso,
  toPtaxUrlDate,
  toSgsUrlDate,
} from './date.js';

describe('parseSgsDate - BCB SGS usa dd/MM/yyyy', () => {
  it('converte o formato brasileiro para ISO', () => {
    expect(parseSgsDate('18/08/2026')).toBe('2026-08-18');
  });

  it('nao confunde dia com mes (08/12 e 8 de dezembro, nao 12 de agosto)', () => {
    expect(parseSgsDate('08/12/2026')).toBe('2026-12-08');
  });

  it('aceita datas mensais, que o SGS publica sempre no dia 01', () => {
    expect(parseSgsDate('01/07/2026')).toBe('2026-07-01');
  });

  it('tolera espacos em volta', () => {
    expect(parseSgsDate('  18/08/2026  ')).toBe('2026-08-18');
  });

  it('rejeita data inexistente em vez de normalizar silenciosamente', () => {
    expect(() => parseSgsDate('30/02/2026')).toThrow(DateParseError);
    expect(() => parseSgsDate('32/01/2026')).toThrow(DateParseError);
  });

  it('rejeita formato ISO recebido por engano no parser errado', () => {
    expect(() => parseSgsDate('2026-08-18')).toThrow(DateParseError);
  });
});

describe('parsePtaxDateTime - PTAX devolve timestamp de divulgacao', () => {
  it('trunca o horario do boletim e mantem so o dia de referencia', () => {
    expect(parsePtaxDateTime('2026-08-12 13:09:28.609891')).toBe('2026-08-12');
  });

  it('aceita o separador ISO com T', () => {
    expect(parsePtaxDateTime('2026-08-10T13:10:22.642754')).toBe('2026-08-10');
  });

  it('aceita data sem hora', () => {
    expect(parsePtaxDateTime('2026-08-12')).toBe('2026-08-12');
  });

  it('rejeita entrada vazia', () => {
    expect(() => parsePtaxDateTime('')).toThrow(DateParseError);
  });
});

describe('parseIsoDate - FRED ja devolve ISO', () => {
  it('valida e devolve a data', () => {
    expect(parseIsoDate('2026-08-12')).toBe('2026-08-12');
  });

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(parseIsoDate('2024-02-29')).toBe('2024-02-29');
  });

  it('rejeita 29 de fevereiro em ano nao bissexto', () => {
    expect(() => parseIsoDate('2026-02-29')).toThrow(DateParseError);
  });

  it('rejeita mes 13', () => {
    expect(() => parseIsoDate('2026-13-01')).toThrow(DateParseError);
  });
});

describe('formatacao para as URLs das fontes', () => {
  it('PTAX (Olinda) espera MM-DD-YYYY', () => {
    expect(toPtaxUrlDate('2026-08-12')).toBe('08-12-2026');
  });

  it('SGS espera dd/MM/yyyy', () => {
    expect(toSgsUrlDate('2026-08-12')).toBe('12/08/2026');
  });

  it('as duas APIs do mesmo BCB usam formatos diferentes para a mesma data', () => {
    const iso = '2026-01-05';
    expect(toPtaxUrlDate(iso)).toBe('01-05-2026');
    expect(toSgsUrlDate(iso)).toBe('05/01/2026');
  });
});

describe('aritmetica de datas', () => {
  it('soma dias atravessando a virada de mes', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('subtrai dias atravessando a virada de ano', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('atravessa 29 de fevereiro em ano bissexto', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('subtrai anos para calcular a janela de backfill', () => {
    expect(subtractYears('2026-08-18', 5)).toBe('2021-08-18');
  });

  it('degrada 29/02 para 28/02 ao subtrair para um ano nao bissexto', () => {
    expect(subtractYears('2024-02-29', 1)).toBe('2023-02-28');
  });

  it('ordena datas ISO cronologicamente', () => {
    expect(compareIsoDates('2026-08-12', '2026-08-18')).toBe(-1);
    expect(compareIsoDates('2026-08-18', '2026-08-12')).toBe(1);
    expect(compareIsoDates('2026-08-18', '2026-08-18')).toBe(0);
  });

  it('todayIso devolve a data UTC no formato ISO', () => {
    expect(todayIso(new Date('2026-08-18T23:59:59Z'))).toBe('2026-08-18');
    expect(todayIso(new Date('2026-08-18T00:00:00Z'))).toBe('2026-08-18');
  });
});
