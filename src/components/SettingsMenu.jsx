import React, { useMemo, useState } from 'react';
import { LAYER_STYLE } from '../lib/colors.js';
import { getLang, numLocale, t, tf } from '../lib/i18n.js';
import LiquidSwitch from './LiquidSwitch.jsx';
import LiquidTabs from './LiquidTabs.jsx';

const TABS = [
  ['layers', 'Layers'],
  ['cases', 'Examples'],
  ['meta', 'Metadata'],
  ['method', 'Method'],
];

const LAYER_SUB = { precip: 'GPM IMERG', temp: 'MERRA-2 T2M', water: 'GRACE/GRACE-FO Mascon', stars: 'MERRA-2 CLDTOT' };

const METHOD = [
  ["What the data describe", [
    "We compare 2005–2025: 21 annual values spanning 20 years. Rainfall comes from GPM IMERG; temperature and cloud cover come from MERRA-2 reanalysis; water storage comes from GRACE/GRACE-FO. These products describe a grid cell or region, not a measurement at an exact street address.",
  ]],
  ["How annual values are built", [
    "Monthly data are combined using monthly climatology and anomalies, reducing seasonal bias in incomplete years. An annual value needs at least nine valid months for these monthly products. Missing annual observations stay missing in the data, exports and trend calculations. Water has no annual observations for 2015, 2017 and 2018. Its chart bridges internal gaps with faint gray linear estimates, clearly marked “Estimated”; these are visual guides, not NASA observations.",
  ]],
  ["How we test a long-term trend", [
    "The **Hamed–Rao Mann–Kendall test** looks for a sustained upward or downward tendency while adjusting for correlation between observations. We apply **Benjamini–Hochberg false discovery rate (FDR)** correction across the tested cells in each layer. A cell passes when its adjusted q-value is below 0.05.",
    "A significant result is evidence of a trend under the test assumptions. It is not a 95% probability that the trend is true. “No statistically significant trend” means this test did not find sufficient evidence for this period; it does not prove that nothing changed. The pipeline requires at least ten valid annual observations.",
  ]],
  ["Rate and possible change year", [
    "**Sen’s slope** is the median of the changes between pairs of observations, divided by the actual number of years between them. **Pettitt’s test** examines a possible change in the level of a place’s annual series. Its year and approximate p-value are exploratory; they do not identify a cause, and are not covered by the global Mann–Kendall FDR correction.",
  ]],
  ["How to read the globe", [
    "“Selected year vs. average” compares a year with its 2005–2025 cell average. “20-year trend” shows change per year. The statistical grid is 1°. The 0.25° display grid and smoothing make the map easier to read; they do not add measurement precision. All layers use a light 0.15° Gaussian display smoothing, followed by scalar interpolation before coloring; annual observations, statistical tests and exports are unchanged. Water also retains its land-only mask and its existing GRACE display smoothing. GRACE/GRACE-FO water storage represents broad mascon regions, approximately 3°, and is shown over land only.",
    "Colors fade toward transparency near the period average or a zero trend, revealing the Earth underneath. Clear patches are not automatically missing data. “Only significant trends” also leaves cells that fail the statistical test uncolored. The red timeline bands mark years without an annual Water value.",
  ]],
  ["What Stars means", [
    "Stars shows clear-sky fraction: 100 × (1 − CLDTOT), from MERRA-2 total cloud cover. It is a cloud-based proxy, not a count of visible stars or a nighttime weather forecast. The light-pollution note uses relative brightness in NASA’s Earth at Night image as a rough visual guide; it is not a calibrated sky-brightness measurement or a 2005–2025 light-pollution trend.",
  ]],
  ["Nearby regional comparison", [
    "The nearby-region reference averages observed 1° cells within 500 km of the sampled cell, weighted by their area. Land is compared with land and ocean with ocean; Water uses land only. Each annual regional mean requires at least five observed cells and 75% of the eligible area. Its Sen slope needs at least ten valid annual means and is descriptive, with no new p-value or significance claim. Chart estimates are excluded.",
  ]],
  ["Loading and exports", [
    "Only the selected layer loads at startup. Opening a place requests the remaining layers for the four charts and complete exports. Compressed binary files preserve the existing frontend arrays exactly; original NASA-derived JSON files remain available in Metadata. No additional quantization is applied.",
  ]],
];

/** Texto con **negritas**. */
function Prose({ text }) {
  return <p className="prose">{text.split('**').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</p>;
}

export default function SettingsMenu({ open, onClose, data, settings, setSettings, activeLayer, setActiveLayer, onCase, onTour, onAbout, geoReady }) {
  const [tab, setTab] = useState('layers');
  const colorOptions = useMemo(
    () => [
      { id: 'anomaly', label: t('Selected year vs. average') },
      { id: 'trend', label: t('20-year trend') },
    ],
    [open, getLang()],
  );
  if (!open) return null;
  const { meta, layers, cases } = data;
  const set = (k) => (v) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="settings glass" role="dialog" aria-label={t('Settings')}>
      <div className="settings-head">
        <span>[ {t('SETTINGS')} ]</span>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close settings')}>
          ×
        </button>
      </div>
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {t(label)}
          </button>
        ))}
      </nav>

      {tab === 'layers' && (
        <div className="settings-body">
          <h5>{t('Globe layer')}</h5>
          <div className="layer-list">
            {meta.layers.map((l) => (
              <button
                key={l.id}
                className={`layer-btn ${activeLayer === l.id ? 'on' : ''}`}
                style={{ '--accent': LAYER_STYLE[l.id].accent }}
                onClick={() => setActiveLayer(l.id)}
              >
                <span className="swatch" />
                <span>
                  <b>{LAYER_STYLE[l.id].name}</b>
                  <small>
                    {LAYER_SUB[l.id]} · {l.source === 'mock' ? t('TEST DATA') : 'NASA'}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <p className="layer-about">{LAYER_STYLE[activeLayer]?.about}</p>
          <h5>{t('Globe colors show')}</h5>
          <LiquidTabs
            className="seg"
            label={t('Globe colors show')}
            value={settings.colorMode}
            onChange={set('colorMode')}
            options={colorOptions}
          />
          <LiquidSwitch label={t('Only significant trends')} hint={t('Hide cells that do not pass the statistical test after FDR correction')} checked={settings.sigOnly} onChange={set('sigOnly')} />
          <LiquidSwitch label={t('Land only')} checked={settings.landOnly} onChange={set('landOnly')} />
          <LiquidSwitch label={t('Auto-rotate globe')} checked={settings.autoRotate} onChange={set('autoRotate')} />
          <LiquidSwitch label={t('Example pins on the globe')} checked={settings.showCases} onChange={set('showCases')} />
          <div className="settings-about">
            <button className="tour-again" onClick={onAbout}>
              ? {t('What is EarthTrends?')}
            </button>
            <button className="tour-again" onClick={onTour}>
              ▶ {t('Replay the guided example')}
            </button>
          </div>
        </div>
      )}

      {tab === 'cases' && (
        <div className="settings-body">
          <h5>{t('{n} example comparisons', { n: cases.length })}</h5>
          <div className="case-list">
            {cases.map((c, i) => (
              <button key={c.id} className="case-btn" onClick={() => onCase(c.id)} style={{ '--accent': LAYER_STYLE[c.layer]?.accent }}>
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <b>{tf(c, 'title')}</b>
                  <small>{tf(c, 'summary')}</small>
                </span>
                <span className="chip">{LAYER_STYLE[c.layer]?.short}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'meta' && (
        <div className="settings-body meta">
          {meta.layers.map((l) => {
            const loaded = layers[l.id];
            const L = loaded || { ...l, years: Array.from({length:meta.years[1]-meta.years[0]+1},(_,i)=>meta.years[0]+i), grid:meta.grid, mk:{...meta.mk,fdr:true}, stats:null };
            return (
              <div key={l.id} className="meta-card">
                <div className="meta-title">
                  <b style={{ color: LAYER_STYLE[l.id].accent }}>{LAYER_STYLE[l.id].name}</b>
                  <span className={`src ${l.source}`}>{l.source === 'mock' ? t('TEST DATA') : t('REAL NASA DATA')}</span>
                </div>
                <dl>
                  <dt>{t('Product')}</dt>
                  <dd>{L.product}</dd>
                  <dt>{t('Units')}</dt>
                  <dd>{LAYER_STYLE[l.id].units}</dd>
                  <dt>{t('Period')}</dt>
                  <dd>
                    {L.years[0]}–{L.years[L.years.length - 1]} ({t('{n} annual values', { n: L.years.length })})
                  </dd>
                  <dt>{t('Grid')}</dt>
                  <dd>
                    {L.grid.res}° · {L.grid.nlat}×{L.grid.nlon} {t('cells')}
                  </dd>
                  <dt>{t('Map display')}</dt>
                  <dd>{L.viz?.res || L.grid.res}° {t('visual grid; display detail does not increase measurement resolution.')}</dd>
                  {l.id === 'water' && <><dt>{t('Coverage')}</dt><dd>{t('Land only. No annual observations for 2015, 2017 or 2018. GRACE mascons represent broad regions, approximately 3°.')}</dd></>}
                  {l.id === 'stars' && <><dt>{t('Meaning')}</dt><dd>{t('Clear-sky fraction from cloud cover; a proxy for star visibility, not an observation of stars.')}</dd></>}
                  <dt>{t('Test')}</dt>
                  <dd>
                    Mann-Kendall ({L.mk.test}){L.mk.fdr ? ' + Benjamini-Hochberg FDR' : ''} · α = {L.mk.alpha}
                  </dd>
                  <dt>{t('Cells')}</dt>
                  <dd>{L.stats ? <>{L.stats.cellsWithData.toLocaleString(numLocale())} {t('with data')} · ↑{L.stats.cellsUp} ↓{L.stats.cellsDown} {t('significant')}</> : <button type="button" className="metadata-load" onClick={() => setActiveLayer(l.id)}>{t('Load layer statistics')}</button>}</dd>
                  <dt>{t('Generated')}</dt>
                  <dd>{new Date(L.generatedAt).toLocaleString(numLocale())}</dd>
                  <dt>{t('Download')}</dt>
                  <dd>
                    <a className="dl" href={`${import.meta.env.BASE_URL}data/${l.file}`} download>
                      ↓ {t('Full global grid (JSON)')}
                    </a>
                    {L.viz?.trend && (
                      <>
                        {' · '}
                        <a className="dl" href={`${import.meta.env.BASE_URL}data/${L.viz.trend}`} download>
                          ↓ {t('Trend map (PNG)')}
                        </a>
                      </>
                    )}
                  </dd>
                  {L.ingest?.files && (
                    <>
                      <dt>{t('Files')}</dt>
                      <dd className="files">{L.ingest.files.join(', ')}</dd>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
          <h5>{t('Sources')}</h5>
          <ul className="sources">
            {meta.sources.map((s) => (
              <li key={s.name}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'method' && (
        <div className="settings-body">
          <h5>{t('What each variable means')}</h5>
          <dl className="var-defs">
            {meta.layers.map((l) => (
              <React.Fragment key={l.id}>
                <dt style={{ color: LAYER_STYLE[l.id].accent }}>{LAYER_STYLE[l.id].name}</dt>
                <dd>{LAYER_STYLE[l.id].about}</dd>
              </React.Fragment>
            ))}
          </dl>
          {METHOD.map(([h, ps]) => (
            <React.Fragment key={h}>
              <h5>{t(h)}</h5>
              {ps.map((x) => <Prose key={x} text={t(x)} />)}
            </React.Fragment>
          ))}
          <h5>{t('Products and references')}</h5>
          <ul className="sources">
            <li><a href="https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary" target="_blank" rel="noreferrer">GPM IMERG Final Monthly · GPM_3IMERGM v07</a></li>
            <li><a href="https://disc.gsfc.nasa.gov/datasets/M2TMNXSLV_5.12.4/summary" target="_blank" rel="noreferrer">MERRA-2 M2TMNXSLV v5.12.4 · T2M</a></li>
            <li><a href="https://disc.gsfc.nasa.gov/datasets/M2TMNXRAD_5.12.4/summary" target="_blank" rel="noreferrer">MERRA-2 M2TMNXRAD v5.12.4 · CLDTOT</a></li>
            <li><a href="https://podaac.jpl.nasa.gov/dataset/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4" target="_blank" rel="noreferrer">GRACE/GRACE-FO JPL Mascon RL06.3 v04 CRI</a></li>
            <li><a href="https://earthobservatory.nasa.gov/features/NightLights" target="_blank" rel="noreferrer">NASA Earth at Night · supplementary brightness guide</a></li>
            <li><a href="https://doi.org/10.1016/S0022-1694(97)00125-X" target="_blank" rel="noreferrer">Hamed &amp; Rao (1998) · modified Mann–Kendall test</a></li>
            <li>{t('Background sky: Yale Bright Star Catalog and constellation lines via d3-celestial (BSD-3), rotated with sidereal time.')}</li>
          </ul>
          <h5>{t('Shortcuts')}</h5>
          <ul className="devlist">
            <li>
              <kbd>Space</kbd> {t('play/pause')} · <kbd>←</kbd>
              <kbd>→</kbd> {t('year')} · <kbd>1</kbd>
              <kbd>2</kbd>
              <kbd>3</kbd> {t('modes')} · <kbd>Esc</kbd> {t('close')}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
