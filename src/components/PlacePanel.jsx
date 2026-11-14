import React, { useMemo } from 'react';
import RegionalContext from './RegionalContext.jsx';
import { TrendChart } from './Charts.jsx';
import { LAYER_STYLE } from '../lib/colors.js';
import { fmtChange, fmtCoord, fmtP, fmtSlope, plainTrend } from '../lib/format.js';
import { placeLayerData } from '../lib/data.js';
import { diagnose } from '../lib/mirror.js';
import { exportPlace } from '../lib/export.js';
import { lightPollutionAt } from '../lib/lightPollution.js';

const ORDER = ['precip', 'temp', 'water', 'stars'];

/** Años sin datos, agrupados en tramos ("2017–2018"). */
function gapText(series) {
  const miss = series.filter((s) => s.v == null).map((s) => s.year);
  if (!miss.length) return null;
  const parts = [];
  let a = miss[0];
  let b = miss[0];
  for (const y of miss.slice(1).concat([null])) {
    if (y === b + 1) b = y;
    else {
      parts.push(a === b ? `${a}` : `${a}–${String(b).slice(2)}`);
      a = b = y;
    }
  }
  return parts.join(', ');
}

/** Visibilidad de estrellas: cielo despejado típico + contaminación lumínica (NASA Black Marble). */
function StarsNote({ d, place }) {
  const lp = lightPollutionAt(place.lat, place.lon);
  return (
    <div className="stars-note">
      <span>
        Clear sky <b>{Number.isFinite(d.mean) ? Math.round(d.mean) : '—'}%</b> of the time (2005–2025 avg.)
      </span>
      {lp && (
        <span className={`lp lp-${lp.level}`} title={`Brightness ${lp.value}/255 in NASA's Earth at Night image`}>
          Light pollution: <b>{lp.label}</b> · {lp.detail}
        </span>
      )}
    </div>
  );
}

export default function PlacePanel({ side, place, layers, meta, activeLayer, year, tag, onClose, onPickLayer, onShare, layerStatus = {}, onRetryLayer, geo }) {
  const byLayer = useMemo(() => {
    const out = {};
    for (const id of ORDER) if (layers[id]) out[id] = placeLayerData(layers[id], place.lat, place.lon);
    return out;
  }, [place, layers]);

  const complete = meta.layers.every(l => layers[l.id]);
  const activeLoaded = !!layers[activeLayer];
  const activeFailed = layerStatus[activeLayer] === 'error';
  const main = byLayer[activeLayer];
  const span = main ? `${main.series[0].year}–${main.series[main.series.length - 1].year}` : '';
  const diag = complete ? diagnose(byLayer, activeLayer) : meta.layers.some(l => layerStatus[l.id] === 'error') ? 'Some layers are unavailable. Retry their cards to complete this view.' : 'Loading the other layers…';
  const head = activeLoaded ? plainTrend(activeLayer, main) : { tone: 'ns', text: activeFailed ? `${LAYER_STYLE[activeLayer].name} could not load` : `Loading ${LAYER_STYLE[activeLayer].short}…` };

  return (
    <aside className={`panel glass panel-${side.toLowerCase()}`} aria-label={`Place ${side}`}>
      <header className="panel-head">
        <div className="panel-title">
          <span className="slot">PLACE {side}:</span> <span className="place-name">{place.name}</span>
          {tag && <span className="panel-tag">({tag})</span>}
          <span className="coords" title={place.note || undefined}>
            {fmtCoord(place.lat, place.lon)}
          </span>
        </div>
        {place.sub && <div className="panel-sub">{place.sub}</div>}
        <button className="icon-btn close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

      <div className={`headline tone-${head.tone}`} style={{ '--accent': LAYER_STYLE[activeLayer].accent }}>
        <span className="headline-kicker">
          {LAYER_STYLE[activeLayer].name} · {span}
        </span>
        <b>{head.text}</b>
        {main && (
          <span className={`trend-chip ${main.sig ? 'ok' : 'noise'}`}>
            <span className="led" />
            {main.sig ? 'Evidence of a long-term trend' : 'No statistically significant trend detected for this period.'}
          </span>
        )}
      </div>

      <div className="panel-body">
        <RegionalContext layer={layers[activeLayer]} placeData={main} year={year} geo={geo} />
        {ORDER.filter(id => meta.layers.some(l => l.id === id)).map((id) => {
          const d = byLayer[id];
          const st = LAYER_STYLE[id];
          return (
            <section
              key={id}
              className={`metric ${id === activeLayer ? 'is-active' : ''}`}
              onClick={() => onPickLayer(id)}
              title="Show this layer on the globe"
            >
              <div className="metric-head">
                <h4>
                  {st.name} <span className="dim">· one {st.chart === 'bars' ? 'bar' : 'point'} per year</span>
                </h4>
                {layers[id]?.source === 'mock' && <span className="mini-mock">TEST</span>}
                {d && gapText(d.series) && (
                  <span className={`mini-gap ${id === 'water' ? 'is-estimated' : ''}`} title={id === 'water' ? 'Gray estimates bridge missing observations for display only; excluded from tests and exports' : 'Missing years'}>
                    {id === 'water' ? 'estimated ' : 'no data '}{gapText(d.series)}
                  </span>
                )}
              </div>
              {!layers[id] ? <div className="metric-loading" role={layerStatus[id] === 'error' ? 'alert' : 'status'}>
                <span>{layerStatus[id] === 'error' ? `Could not load ${st.short}.` : `Loading ${st.short}…`}</span>
                {layerStatus[id] === 'error' && <button type="button" onClick={e => { e.stopPropagation(); onRetryLayer?.(id); }}>Retry</button>}
              </div> : d ? (
                <>
                  <TrendChart layerId={id} data={d} kind={st.chart} color={st.accent} year={year} />
                  <div className={`trend-label ${d.sig ? 'sig' : 'ns'}`} style={{ color: d.sig ? st.accent : undefined }}>
                    {fmtChange(id, d)} since {d.series[0].year}{' '}
                    <span className="dim">{d.sig ? '· ✓ significant trend' : '· no significant trend'}</span>
                  </div>
                  {id === 'stars' && <StarsNote d={d} place={place} />}
                </>
              ) : (
                <div className="nodata">
                  {id === 'water' ? 'Water storage is only measured over land' : 'No data for this spot'}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <footer className="panel-foot">
        <p className="diag">{diag}</p>
        <div className="export-row">
          <span className="export-label">Export data</span>
          {[
            ['csv', 'CSV'],
            ['json', 'JSON'],
            ['geojson', 'GeoJSON'],
          ].map(([f, label]) => (
            <button key={f} disabled={!complete} onClick={() => exportPlace(f, place, layers, meta)} title={complete ? `Download this place's 20-year series and trend results as ${label}` : 'Load all four layers before exporting'}>
              ↓ {label}
            </button>
          ))}
          {onShare && (
            <button className="share-btn" onClick={onShare} aria-label="Copy link" title="Copy a link that opens exactly this view">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m10 13 4-4M8 16l-1 1a4.24 4.24 0 0 1-6-6l4-4a4.24 4.24 0 0 1 6 0m2 1 1-1a4.24 4.24 0 0 1 6 6l-4 4a4.24 4.24 0 0 1-6 0" transform="translate(1 1)" />
              </svg>
            </button>
          )}
        </div>
        {main && (
          <details className="stats-details">
            <summary>Statistical details</summary>
            <div className="mk-line">
              <span>
                Mann-Kendall ({main.test || 'original'}){main.fdr ? ' + FDR' : ''}
              </span>
              <span>τ = {Number.isFinite(main.tau) ? main.tau.toFixed(2) : '—'}</span>
              <span>{fmtP(main.p)}</span>
              {main.fdr && <span>q(FDR) = {Number.isFinite(main.q) ? (main.q < 0.001 ? '<0.001' : main.q.toFixed(3)) : '—'}</span>}
              <span>Sen slope {fmtSlope(activeLayer, main.slope)}</span>
              {main.pettitt && main.pettitt.p < 0.05 && <span>break year ≈ {main.pettitt.year}</span>}
              <span>{span}</span>
            </div>
          </details>
        )}
      </footer>
    </aside>
  );
}
