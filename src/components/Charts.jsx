import React, { useMemo, useState } from 'react';
import { estimateInternalGaps } from '../lib/chartEstimates.js';
import { fmtValue } from '../lib/format.js';

const VW = 300;
const VH = 84;
const PAD_T = 6;
const PAD_B = 4;

function domain(series, d) {
  const vals = series.map((s) => s.v).filter((v) => v != null);
  const trend = [];
  if (Number.isFinite(d.slope)) {
    const y0 = series[0].year;
    trend.push(d.intercept, d.intercept + d.slope * (series[series.length - 1].year - y0));
  }
  const all = vals.concat(trend);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (!Number.isFinite(lo)) return [0, 1];
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * 0.55, hi + span * 0.12];
}

/** Gráfico temporal 2005-2025: barras (lluvia) o área (temperatura/agua) + línea de Sen. */
export function TrendChart({ layerId, data, kind, color, year, onHoverYear }) {
  const [hover, setHover] = useState(null);
  const { series } = data;
  const estimates = useMemo(() => layerId === 'water' ? estimateInternalGaps(series) : null, [layerId, series]);
  const n = series.length;
  const [lo, hi] = useMemo(() => domain(series, data), [series, data]);
  const x = (i) => (n === 1 ? VW / 2 : (i / (n - 1)) * VW);
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (VH - PAD_T - PAD_B);
  const bw = (VW / n) * 0.62;
  const bx = (i) => (i + 0.5) * (VW / n) - bw / 2;
  const cx = kind === 'bars' ? (i) => (i + 0.5) * (VW / n) : x;
  const gid = `g-${layerId}-${kind}`;

  const segs = [];
  let cur = [];
  series.forEach((s, i) => {
    if (s.v == null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else cur.push([cx(i), y(s.v)]);
  });
  if (cur.length) segs.push(cur);

  const trendLine = Number.isFinite(data.slope)
    ? [
        [cx(0), y(data.intercept)],
        [cx(n - 1), y(data.intercept + data.slope * (series[n - 1].year - series[0].year))],
      ]
    : null;

  const yi = series.findIndex((s) => s.year === year);
  const hi_i = hover ?? yi;
  const shown = estimates?.points[hi_i] || series[hi_i];

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const i = Math.max(0, Math.min(n - 1, Math.round(kind === 'bars' ? fx * n - 0.5 : fx * (n - 1))));
    setHover(i);
    onHoverYear?.(series[i].year);
  };

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
          onHoverYear?.(null);
        }}
        role="img"
        aria-label={`Series ${layerId} ${series[0].year}–${series[n - 1].year}${estimates?.bridges.length ? ". Gray dashed segments are estimated, not observed." : ""}`}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={VW} y1={VH * g} y2={VH * g} className="grid" />
        ))}
        {kind === 'bars' ? (
          <g className="bars">
            {series.map((s, i) =>
              s.v == null ? null : (
                <rect
                  key={s.year}
                  x={bx(i)}
                  width={bw}
                  y={y(s.v)}
                  height={VH - y(s.v)}
                  fill={color}
                  opacity={i === hi_i ? 1 : 0.72}
                  style={{ animationDelay: `${i * 22}ms` }}
                />
              ),
            )}
          </g>
        ) : (
          <g className="area">
            {segs.map((pts, k) => (
              <g key={k}>
                <path
                  d={`M${pts[0][0]},${VH} L${pts.map((p) => p.join(',')).join(' L')} L${pts[pts.length - 1][0]},${VH} Z`}
                  fill={`url(#${gid})`}
                />
                <path d={`M${pts.map((p) => p.join(',')).join(' L')}`} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          </g>
        )}
        {estimates?.bridges.map((points, k) => {
          const coords = points.map(p => [cx(p.index), y(p.v)]);
          return <g key={`estimated-${k}`} className="chart-estimate">
            <title>Linear estimate between observed years; excluded from trend tests and exports.</title>
            <path className="estimate-area" d={`M${coords[0][0]},${VH} L${coords.map(p => p.join(',')).join(' L')} L${coords[coords.length - 1][0]},${VH} Z`} />
            <path className="estimate-line" d={`M${coords.map(p => p.join(',')).join(' L')}`} vectorEffect="non-scaling-stroke" />
            {points.filter(p => p.estimated).map(p => <circle key={p.year} cx={cx(p.index)} cy={y(p.v)} r="1.5" />)}
          </g>;
        })}
        {trendLine && (
          <line
            x1={trendLine[0][0]}
            y1={trendLine[0][1]}
            x2={trendLine[1][0]}
            y2={trendLine[1][1]}
            className={`trendline ${data.sig ? 'sig' : ''}`}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hi_i >= 0 && <line x1={cx(hi_i)} x2={cx(hi_i)} y1="0" y2={VH} className="cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      {estimates?.bridges.length > 0 && <span className="estimate-key" title="Linear interpolation for display only; original data and statistical tests keep these years missing.">Gray dashed: estimated</span>}
      {shown && (
        <div className={`chart-readout ${shown.estimated ? 'is-estimated' : ''}`}>
          <span>{shown.year}</span>
          <b>{fmtValue(layerId, shown.v)}</b>
          {shown.estimated && <span>Estimated</span>}
        </div>
      )}
    </div>
  );
}
