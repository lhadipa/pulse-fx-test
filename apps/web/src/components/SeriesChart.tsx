import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { IndicatorUnit, Observation } from '@pulse-fx/shared';
import { formatRefDate, formatValue } from '../lib/format.js';

interface Props {
  observations: Observation[];
  unit: IndicatorUnit;
  precision: number;
}

export function SeriesChart({ observations, unit, precision }: Props): JSX.Element {
  // Recharts precisa de number; a conversao acontece so aqui, para desenho.
  // Nenhum calculo de negocio depende deste valor.
  const data = observations.map((o) => ({
    refDate: o.refDate,
    value: Number(o.value),
  }));

  return (
    <div className="h-72 w-full" role="img" aria-label={`Grafico da serie com ${data.length} observacoes`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="seriesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis
            dataKey="refDate"
            tickFormatter={formatRefDate}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            domain={['auto', 'auto']}
            width={70}
            tickFormatter={(value: number) => value.toLocaleString('pt-BR')}
          />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#e2e8f0',
            }}
            labelFormatter={(label: string) => formatRefDate(label)}
            formatter={(value: number) => [formatValue(String(value), unit, precision), 'Valor']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#38bdf8"
            strokeWidth={2}
            fill="url(#seriesFill)"
            // Sem interpolacao visual entre pontos ausentes: a serie so liga
            // observacoes que existem de verdade.
            connectNulls={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
