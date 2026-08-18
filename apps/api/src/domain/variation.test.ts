import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  calculateVariation,
  latestObservation,
  policyFor,
  selectValidObservations,
  VARIATION_POLICIES,
} from './variation.js';
import type { Observation } from './types.js';

/** Helper para montar observacoes sem ruido nos testes. */
const obs = (refDate: string, value: string): Observation => ({
  refDate,
  value: new Decimal(value),
});

const TODAY = '2026-08-18';

describe('calculateVariation - series diarias (N = 1 fechamento anterior)', () => {
  const policy = VARIATION_POLICIES.DAILY;

  it('calcula alta percentual contra o fechamento anterior disponivel', () => {
    // Valores reais do PTAX: 11/08 -> 5.12850, 12/08 -> 5.16390
    const result = calculateVariation(
      [obs('2026-08-11', '5.12850'), obs('2026-08-12', '5.16390')],
      policy,
      TODAY,
    );

    expect(result).not.toBeNull();
    expect(result!.latest.refDate).toBe('2026-08-12');
    expect(result!.previous.refDate).toBe('2026-08-11');
    expect(result!.absolute.toString()).toBe('0.0354');
    expect(result!.percent!.toFixed(4)).toBe('0.6903');
    expect(result!.lag).toBe(1);
    expect(result!.lagUnit).toBe('business_day');
  });

  it('calcula queda com sinal negativo', () => {
    const result = calculateVariation(
      [obs('2026-08-17', '5.2014'), obs('2026-08-14', '5.2236')],
      policy,
      TODAY,
    );

    expect(result!.absolute.toString()).toBe('-0.0222');
    expect(result!.percent!.isNegative()).toBe(true);
    expect(result!.percent!.toFixed(4)).toBe('-0.4250');
  });

  it('pula o fim de semana sem interpolar: segunda compara com sexta', () => {
    // 15/08 (sab) e 16/08 (dom) nao existem na serie. O anterior da
    // segunda-feira 17/08 e a sexta-feira 14/08, e nao um valor inventado.
    const result = calculateVariation(
      [obs('2026-08-14', '5.2236'), obs('2026-08-17', '5.2014')],
      policy,
      TODAY,
    );

    expect(result!.latest.refDate).toBe('2026-08-17');
    expect(result!.previous.refDate).toBe('2026-08-14');
  });

  it('respeita um lag maior contando observacoes disponiveis, nao dias de calendario', () => {
    const result = calculateVariation(
      [
        obs('2026-08-12', '5.00'),
        obs('2026-08-13', '5.10'),
        obs('2026-08-14', '5.20'),
        obs('2026-08-17', '5.30'),
      ],
      policyFor('DAILY', 3),
      TODAY,
    );

    expect(result!.latest.refDate).toBe('2026-08-17');
    expect(result!.previous.refDate).toBe('2026-08-12');
    expect(result!.percent!.toFixed(4)).toBe('6.0000');
  });
});

describe('calculateVariation - series mensais (N = 1 mes)', () => {
  const policy = VARIATION_POLICIES.MONTHLY;

  it('compara o ultimo mes com o mes anterior, nao com os ultimos dias', () => {
    // IPCA real: 05/2026 0.58, 06/2026 0.16, 07/2026 0.07
    const result = calculateVariation(
      [obs('2026-05-01', '0.58'), obs('2026-06-01', '0.16'), obs('2026-07-01', '0.07')],
      policy,
      TODAY,
    );

    expect(result!.latest.refDate).toBe('2026-07-01');
    expect(result!.previous.refDate).toBe('2026-06-01');
    expect(result!.lagUnit).toBe('month');
    expect(result!.absolute.toString()).toBe('-0.09');
  });
});

describe('calculateVariation - observacoes com data futura', () => {
  it('ignora datas no futuro (armadilha da meta Selic, serie SGS 432)', () => {
    // Consultada em 18/08/2026, a serie 432 devolve a meta vigente projetada
    // ate a proxima reuniao do COPOM: 15/09 e 16/09, ambas no futuro.
    const result = calculateVariation(
      [
        obs('2026-08-17', '13.90'),
        obs('2026-08-18', '14.00'),
        obs('2026-09-15', '14.00'),
        obs('2026-09-16', '14.00'),
      ],
      VARIATION_POLICIES.DAILY,
      TODAY,
    );

    expect(result!.latest.refDate).toBe('2026-08-18');
    expect(result!.previous.refDate).toBe('2026-08-17');
  });

  it('latestObservation nunca devolve uma data que ainda nao aconteceu', () => {
    const latest = latestObservation([obs('2026-09-16', '14.00'), obs('2026-08-10', '13.90')], TODAY);
    expect(latest!.refDate).toBe('2026-08-10');
  });

  it('aceita uma observacao datada exatamente de hoje', () => {
    const latest = latestObservation([obs(TODAY, '5.2043')], TODAY);
    expect(latest!.refDate).toBe(TODAY);
  });
});

describe('calculateVariation - dados insuficientes', () => {
  it('devolve null para serie vazia', () => {
    expect(calculateVariation([], VARIATION_POLICIES.DAILY, TODAY)).toBeNull();
  });

  it('devolve null com uma unica observacao (nao ha denominador)', () => {
    expect(
      calculateVariation([obs('2026-08-18', '5.2043')], VARIATION_POLICIES.DAILY, TODAY),
    ).toBeNull();
  });

  it('devolve null quando todas as observacoes sao futuras', () => {
    expect(
      calculateVariation(
        [obs('2026-09-15', '14.00'), obs('2026-09-16', '14.00')],
        VARIATION_POLICIES.DAILY,
        TODAY,
      ),
    ).toBeNull();
  });

  it('devolve null quando o lag exigido excede as observacoes disponiveis', () => {
    const result = calculateVariation(
      [obs('2026-08-17', '5.1'), obs('2026-08-18', '5.2')],
      policyFor('DAILY', 5),
      TODAY,
    );
    expect(result).toBeNull();
  });
});

describe('calculateVariation - guardas numericas', () => {
  it('devolve percent nulo quando o denominador e zero, preservando o absoluto', () => {
    const result = calculateVariation(
      [obs('2026-06-01', '0.00'), obs('2026-07-01', '0.15')],
      VARIATION_POLICIES.MONTHLY,
      TODAY,
    );

    expect(result!.percent).toBeNull();
    expect(result!.absolute.toString()).toBe('0.15');
  });

  it('usa o modulo do denominador para nao inverter o sinal em valores negativos', () => {
    // IGP-M pode ser negativo: de -1.16 para -0.58 o indice SUBIU.
    const result = calculateVariation(
      [obs('2026-06-01', '-1.16'), obs('2026-07-01', '-0.58')],
      VARIATION_POLICIES.MONTHLY,
      TODAY,
    );

    expect(result!.absolute.toString()).toBe('0.58');
    expect(result!.percent!.isPositive()).toBe(true);
    expect(result!.percent!.toFixed(4)).toBe('50.0000');
  });

  it('arredonda o percentual em 4 casas com meia-unidade para cima', () => {
    const result = calculateVariation(
      [obs('2026-08-17', '3'), obs('2026-08-18', '3.00001')],
      VARIATION_POLICIES.DAILY,
      TODAY,
    );
    expect(result!.percent!.toString()).toBe('0.0003');
  });

  it('nao acumula erro de ponto flutuante (0.1 + 0.2 nao vira 0.30000000000000004)', () => {
    const result = calculateVariation(
      [obs('2026-08-17', '0.1'), obs('2026-08-18', '0.3')],
      VARIATION_POLICIES.DAILY,
      TODAY,
    );
    expect(result!.absolute.toString()).toBe('0.2');
    expect(result!.percent!.toFixed(4)).toBe('200.0000');
  });

  it('devolve variacao zero, e nao null, quando o valor nao mudou', () => {
    const result = calculateVariation(
      [obs('2026-08-17', '14.00'), obs('2026-08-18', '14.00')],
      VARIATION_POLICIES.DAILY,
      TODAY,
    );
    expect(result).not.toBeNull();
    expect(result!.percent!.isZero()).toBe(true);
  });
});

describe('selectValidObservations', () => {
  it('ordena da mais recente para a mais antiga independente da ordem de entrada', () => {
    const sorted = selectValidObservations(
      [obs('2026-08-12', '1'), obs('2026-08-18', '2'), obs('2026-08-14', '3')],
      TODAY,
    );
    expect(sorted.map((o) => o.refDate)).toEqual(['2026-08-18', '2026-08-14', '2026-08-12']);
  });

  it('descarta valores nao finitos vindos de parse defeituoso', () => {
    const withNaN: Observation = { refDate: '2026-08-18', value: new Decimal(NaN) };
    const result = selectValidObservations([withNaN, obs('2026-08-17', '5.2')], TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.refDate).toBe('2026-08-17');
  });

  it('nao muta o array recebido', () => {
    const input = [obs('2026-08-12', '1'), obs('2026-08-18', '2')];
    selectValidObservations(input, TODAY);
    expect(input[0]!.refDate).toBe('2026-08-12');
  });
});
