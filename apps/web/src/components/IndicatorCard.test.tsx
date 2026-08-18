import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { IndicatorSummary } from '@pulse-fx/shared';
import { IndicatorCard } from './IndicatorCard.js';

function makeIndicator(overrides: Partial<IndicatorSummary> = {}): IndicatorSummary {
  return {
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
    ...overrides,
  };
}

function renderCard(indicator: IndicatorSummary, onToggle = vi.fn()) {
  render(
    <MemoryRouter>
      <IndicatorCard indicator={indicator} onToggleFavorite={onToggle} />
    </MemoryRouter>,
  );
  return { onToggle };
}

describe('IndicatorCard', () => {
  it('exibe nome, ultimo valor, data de referencia e variacao', () => {
    renderCard(makeIndicator());

    expect(screen.getByText('USD/BRL PTAX')).toBeInTheDocument();
    expect(screen.getByText('R$ 5,1639')).toBeInTheDocument();
    expect(screen.getByText('12/08/2026')).toBeInTheDocument();
    expect(screen.getByLabelText(/Variacao/).textContent).toContain('+0,69%');
  });

  it('formata numeros no padrao brasileiro, com virgula decimal', () => {
    renderCard(makeIndicator({ latest: { refDate: '2026-08-12', value: '1234.5678' } }));
    expect(screen.getByText('R$ 1.234,5678')).toBeInTheDocument();
  });

  it('mostra a variacao de queda com seta e sinal negativo', () => {
    renderCard(
      makeIndicator({
        variation: { absolute: '-0.0222', percent: '-0.4250', lag: 1, lagUnit: 'business_day' },
      }),
    );

    const badge = screen.getByLabelText(/Variacao/);
    expect(badge.textContent).toContain('▼');
    expect(badge.textContent).toContain('-0,43%');
  });

  it('nao usa apenas a cor para indicar direcao (seta e sinal presentes)', () => {
    renderCard(makeIndicator());

    // Requisito de acessibilidade: daltonismo e impressao monocromatica.
    const badge = screen.getByLabelText(/Variacao/);
    expect(badge.textContent).toContain('▲');
    expect(badge.textContent).toContain('+');
  });

  it('torna o denominador da variacao explicito no rotulo acessivel', () => {
    renderCard(makeIndicator());

    const badge = screen.getByLabelText(/Variacao/);
    expect(badge.getAttribute('aria-label')).toContain('R$ 5,1285');
    expect(badge.getAttribute('aria-label')).toContain('11/08/2026');
  });

  it('descreve o denominador como "mes anterior" em serie mensal', () => {
    renderCard(
      makeIndicator({
        frequency: 'MONTHLY',
        unit: 'PERCENT',
        precision: 2,
        latest: { refDate: '2026-07-01', value: '0.07' },
        previous: { refDate: '2026-06-01', value: '0.16' },
        variation: { absolute: '-0.09', percent: '-56.2500', lag: 1, lagUnit: 'month' },
      }),
    );

    expect(screen.getByLabelText(/Variacao/).getAttribute('aria-label')).toContain('mes anterior');
  });

  it('mostra "sem dado" em vez de 0% quando nao ha variacao calculavel', () => {
    renderCard(makeIndicator({ previous: null, variation: null }));

    expect(screen.getByText('sem dado')).toBeInTheDocument();
    expect(screen.queryByText(/0,00%/)).not.toBeInTheDocument();
  });

  it('exibe "--" quando a serie ainda nao sincronizou', () => {
    renderCard(makeIndicator({ latest: null, previous: null, variation: null }));
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('separa data de referencia de hora da sincronizacao', () => {
    renderCard(makeIndicator());

    // Sao dois campos distintos: o briefing avisa para nao confundi-los.
    expect(screen.getByText(/referencia:/)).toBeInTheDocument();
    expect(screen.getByText(/sincronizado/)).toBeInTheDocument();
  });

  it('avisa quando o indicador nunca foi sincronizado', () => {
    renderCard(makeIndicator({ lastSyncedAt: null }));
    expect(screen.getByText(/nunca sincronizado/)).toBeInTheDocument();
  });

  it('dispara o toggle de favorito informando o estado atual', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderCard(makeIndicator({ isFavorite: false }));

    await user.click(screen.getByRole('button', { name: /Adicionar USD\/BRL PTAX/ }));

    expect(onToggle).toHaveBeenCalledWith('usd-brl-ptax', false);
  });

  it('reflete o estado de favorito em aria-pressed e no rotulo', () => {
    renderCard(makeIndicator({ isFavorite: true }));

    const button = screen.getByRole('button', { name: /Remover USD\/BRL PTAX/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('linka para a pagina de detalhe do indicador', () => {
    renderCard(makeIndicator());

    expect(screen.getByRole('link', { name: 'USD/BRL PTAX' })).toHaveAttribute(
      'href',
      '/indicadores/usd-brl-ptax',
    );
  });

  it('formata juros com sufixo de porcentagem', () => {
    renderCard(
      makeIndicator({
        unit: 'PERCENT_PER_YEAR',
        precision: 2,
        latest: { refDate: '2026-08-17', value: '13.90' },
      }),
    );

    expect(screen.getByText('13,90%')).toBeInTheDocument();
  });

  it('formata indice sem simbolo de moeda nem porcentagem', () => {
    renderCard(
      makeIndicator({
        unit: 'INDEX',
        precision: 4,
        latest: { refDate: '2026-08-12', value: '110.2215' },
      }),
    );

    expect(screen.getByText('110,2215')).toBeInTheDocument();
  });
});
