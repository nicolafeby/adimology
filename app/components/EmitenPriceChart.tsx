'use client';

import React from 'react';
import {
  ComposedChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Scatter,
  Cell
} from 'recharts';

interface AnalysisRecord {
  id: number;
  from_date: string;
  emiten: string;
  harga?: number;
  target_realistis?: number;
  target_max?: number;
  real_harga?: number;
  max_harga?: number;
}

interface EmitenPriceChartProps {
  data: AnalysisRecord[];
  headerHeight: number;
  rowHeight: number;
}

export default function EmitenPriceChart({ data, headerHeight, rowHeight }: EmitenPriceChartProps) {
  const chartData = data.map((d, index) => ({
    ...d,
    index,
    maxHit: d.target_max && d.max_harga && d.max_harga >= d.target_max ? 'target-max' : 
             (d.target_realistis && d.max_harga && d.max_harga >= d.target_realistis ? 'target-r1' : 'none'),
    closeHit: d.target_max && d.real_harga && d.real_harga >= d.target_max ? 'target-max' : 
              (d.target_realistis && d.real_harga && d.real_harga >= d.target_realistis ? 'target-r1' : 'none'),
  }));

  const allPrices = data.flatMap(d => [
    d.harga, d.target_realistis, d.target_max, d.max_harga, d.real_harga
  ].filter((p): p is number => typeof p === 'number'));
  
  if (allPrices.length === 0) return null;

  const minPrice = Math.min(...allPrices) * 0.98;
  const maxPrice = Math.max(...allPrices) * 1.02;
  const chartHeight = headerHeight + (data.length * rowHeight);

  return (
    <div style={{ width: '100%', minWidth: 0, height: `${chartHeight}px`, minHeight: `${chartHeight}px`, position: 'relative' }}>
      <ResponsiveContainer width="100%" height={chartHeight} minWidth={0} minHeight={chartHeight}>
        <ComposedChart
          layout="vertical"
          data={chartData}
          margin={{ top: rowHeight / 2, right: 15, bottom: rowHeight / 2, left: 15 }}
        >
          <XAxis 
            type="number" 
            domain={[minPrice, maxPrice]} 
            hide 
          />
          <YAxis 
            dataKey="index" 
            type="category" 
            hide 
            domain={[0, data.length - 1]}
            reversed={false} // Match table flow (index 0 is first row at top)
          />
          
          {/* Target R1 Dotted Line markers - Use semi-transparent stroke */}
          <Scatter dataKey="target_realistis" shape={(props: any) => {
            const { cx, cy } = props;
            if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) return <g />;
            return <rect x={cx - 1} y={cy - (rowHeight/3)} width={2} height={rowHeight * 0.6} fill="var(--accent-success)" opacity={0.3} />;
          }} />

          {/* Target Max Dotted Line markers */}
          <Scatter dataKey="target_max" shape={(props: any) => {
            const { cx, cy } = props;
            if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) return <g />;
            return <rect x={cx - 1} y={cy - (rowHeight/3)} width={2} height={rowHeight * 0.6} fill="var(--accent-warning)" opacity={0.3} />;
          }} />

          {/* Max Harga Dot */}
          <Scatter dataKey="max_harga">
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-max-${index}`} 
                fill={entry.maxHit === 'target-max' ? 'var(--accent-warning)' : (entry.maxHit === 'target-r1' ? 'var(--accent-success)' : 'var(--text-muted)')}
                r={entry.maxHit !== 'none' ? 4 : 2.5}
                stroke="var(--bg-primary)"
                strokeWidth={1}
              />
            ))}
          </Scatter>

          {/* Real Harga (Close) Dot */}
          <Scatter dataKey="real_harga">
             {chartData.map((entry, index) => (
              <Cell 
                key={`cell-close-${index}`} 
                fill={entry.closeHit === 'target-max' ? 'var(--accent-warning)' : (entry.closeHit === 'target-r1' ? 'var(--accent-success)' : 'var(--text-primary)')}
                r={entry.closeHit !== 'none' ? 3 : 2}
                stroke="var(--bg-primary)"
                strokeWidth={1}
              />
            ))}
          </Scatter>
          
          {/* Entry Price marker */}
          <Scatter dataKey="harga" fill="var(--text-muted)" shape="circle" r={1.5} opacity={0.5} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
