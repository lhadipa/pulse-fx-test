import type {
  IndicatorDetail,
  IndicatorSummary,
  Observation as ObservationDto,
  Variation as VariationDto,
} from '@pulse-fx/shared';
import type { IndicatorView } from '../../application/list-indicators.usecase.js';
import { DEFAULT_WINDOW } from '../../application/get-series.usecase.js';
import type { Observation, Variation } from '../../domain/types.js';

/**
 * Traducao dominio -> DTO.
 *
 * Todo numero sai como STRING. Serializar Decimal como number devolveria o
 * valor ao mundo do double e reintroduziria o erro de precisao que o resto do
 * sistema evita - justamente na fronteira em que o dado vira visivel.
 */

export function toObservationDto(observation: Observation): ObservationDto {
  return { refDate: observation.refDate, value: observation.value.toString() };
}

export function toVariationDto(variation: Variation): VariationDto {
  return {
    absolute: variation.absolute.toString(),
    percent: variation.percent ? variation.percent.toString() : null,
    lag: variation.lag,
    lagUnit: variation.lagUnit,
  };
}

export function toIndicatorSummaryDto(view: IndicatorView): IndicatorSummary {
  const { indicator } = view;

  return {
    code: indicator.code,
    name: indicator.name,
    shortName: indicator.shortName,
    source: indicator.source,
    unit: indicator.unit,
    frequency: indicator.frequency,
    precision: indicator.precision,
    latest: view.latest ? toObservationDto(view.latest) : null,
    // O denominador da variacao vai explicito para a UI, como exige a secao 5
    // do briefing: o usuario consegue ver contra o que a variacao foi medida.
    previous: view.variation ? toObservationDto(view.variation.previous) : null,
    variation: view.variation ? toVariationDto(view.variation) : null,
    isFavorite: view.isFavorite,
    lastSyncedAt: view.lastSyncedAt ? view.lastSyncedAt.toISOString() : null,
  };
}

export function toIndicatorDetailDto(view: IndicatorView): IndicatorDetail {
  const { indicator } = view;

  return {
    ...toIndicatorSummaryDto(view),
    rationale: indicator.rationale,
    limitations: indicator.limitations,
    sourceUrl: indicator.sourceUrl,
    defaultWindow: DEFAULT_WINDOW[indicator.frequency],
  };
}
