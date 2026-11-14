import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GlobeView from './components/GlobeView.jsx';
import PlacePanel from './components/PlacePanel.jsx';
import Timeline from './components/Timeline.jsx';
import LiquidTabs from './components/LiquidTabs.jsx';
import { unavailableYears } from './lib/timeline.js';
import LoadingScreen from './components/LoadingScreen.jsx';
import SettingsMenu from './components/SettingsMenu.jsx';
import { ExamplesDock, TourBubble, Welcome } from './components/Onboarding.jsx';
import { placeLayerData } from './lib/data.js';
import { loadCatalog, loadLayer } from './lib/dataClient.js';
import { createLayerStore } from './lib/layerStore.js';
import ErrorScreen from './components/ErrorScreen.jsx';
import { loadGeo } from './lib/geo.js';
import SearchBox from './components/SearchBox.jsx';
import { copyLink, readShareState, writeShareState } from './lib/share.js';
import { loadLightPollution } from './lib/lightPollution.js';
import { createGlobeTexture } from './lib/texture.js';
import { findOpposite } from './lib/mirror.js';
import { greatCircleKm, midpoint } from './lib/stats.js';
import { LAYER_STYLE, legendGradient } from './lib/colors.js';
import { plainTrend } from './lib/format.js';
import { LANGS, getLang, saveLang, setLang, t, tf } from './lib/i18n.js';

const MODES = [
  ['explore', 'ONE PLACE', 'Click a spot to see its 20-year trend'],
  ['versus', 'COMPARE', 'Pick two places and compare them side by side'],
  ['opposite', 'MIRROR', 'Click a spot and we find a place changing the opposite way'],
];
const modeOptions = () => MODES.map(([id, label, description]) => ({ id, label: t(label), description: t(description) }));
const MIRROR_TAG = 'climate mirror';

let uid = 0;

const PHONE_MQ = '(max-width: 860px), (max-height: 500px) and (max-width: 1000px)';
const LAND_MQ = '(max-height: 500px) and (max-width: 1000px)';

export default function App() {
  const [data, setData] = useState(null);
  const [geo, setGeo] = useState(null);
  const [tex, setTex] = useState(null);
  const [progress, setProgress] = useState(() => t('Loading NASA climate data…'));
  const [lang, setLangState] = useState(getLang);
  const [langOpen, setLangOpen] = useState(false);
  const MODE_OPTIONS = useMemo(modeOptions, [lang]);
  const changeLang = useCallback((l) => {
    setLang(l);
    saveLang(l);
    setLangState(l);
    setLangOpen(false);
  }, []);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const store = useRef(null);
  const mirrorRequest = useRef(0);
  const mirrorFlightTimer = useRef();
  const [error, setError] = useState(null);

  const [mode, setMode] = useState('explore');
  const [placeA, setPlaceA] = useState(null);
  const [placeB, setPlaceB] = useState(null);
  const [tagB, setTagB] = useState(null);
  const [slot, setSlot] = useState('A');
  const [activeLayer, setActiveLayer] = useState('precip');
  const [yearIdx, setYearIdx] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const restored = useRef(false);
  const initialShare = useRef(readShareState());
  const [geoReady, setGeoReady] = useState(false);
  const [toast, setToast] = useState(null);
  const [welcome, setWelcome] = useState(true);
  const [tour, setTour] = useState(null); // índice del paso del recorrido guiado
  const [touched, setTouched] = useState(false);
  // Celular: una sola "hoja" con el lugar (pestañas A/B) que se puede bajar para ver el globo
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_MQ).matches);
  const [isLand, setIsLand] = useState(() => window.matchMedia(LAND_MQ).matches);
  const [sheetSide, setSheetSide] = useState('A');
  const [sheetOpen, setSheetOpen] = useState(true);
  const [examplesOpen, setExamplesOpen] = useState(true);
  const [settings, setSettings] = useState({
    colorMode: 'anomaly',
    sigOnly: false,
    landOnly: false,
    autoRotate: true,
    showCases: true,
  });
  const globe = useRef();

  // Load the catalog and the requested layer only; other layers remain on demand.
  useEffect(() => {
    let alive = true, ownedTexture, ownedStore, unsubscribe;
    const controller = new AbortController();
    restored.current = false;
    setError(null); setData(null); setTex(null); setGeoReady(false);
    setProgress(t('Loading NASA climate data…'));
    (async () => {
      try {
        const [catalog, g] = await Promise.all([
          loadCatalog({ signal: controller.signal }), loadGeo({ signal: controller.signal }), loadLightPollution(),
        ]);
        if (!alive) return;
        ownedStore = createLayerStore(catalog, loadLayer); store.current = ownedStore;
        const requested = readShareState()?.layer;
        const first = catalog.meta.layers.some(l => l.id === requested) ? requested : catalog.meta.layers[0].id;
        setProgress(t('Loading {name}…', { name: LAYER_STYLE[first].short }));
        const texturePromise = createGlobeTexture(g).then(gt => {
          if (!alive || controller.signal.aborted) { gt.dispose(); return null; }
          ownedTexture = gt; return gt;
        });
        const [L, globeTex] = await Promise.all([ownedStore.ensure(first), texturePromise]);
        if (!alive || !globeTex) return;
        unsubscribe = ownedStore.subscribe(snapshot => { if (alive) setData(snapshot); });
        setData(ownedStore.snapshot()); setGeo(g); setTex(globeTex);
        setActiveLayer(first); setYearIdx(L.years.length - 1);
        const idle = window.requestIdleCallback || (fn => setTimeout(fn, 100));
        idle(async () => {
          if (!alive) return;
          await g.prepareLandMask(L.grid, () => !alive);
          if (alive) setGeoReady(true);
        });
      } catch (e) {
        controller.abort(); ownedStore?.dispose(); ownedTexture?.dispose(); ownedTexture = null;
        if (alive) { console.error('Climate data could not load', e); setError(e); }
      }
    })();
    return () => {
      alive = false; controller.abort(); unsubscribe?.(); ownedStore?.dispose(); ownedTexture?.dispose();
      mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
    };
  }, [loadAttempt]);

  const layer = data?.layers[activeLayer];
  const years = useMemo(() => {
    if (layer) return layer.years;
    if (!data?.meta.years) return [];
    const [start, end] = data.meta.years;
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [layer, data?.meta]);
  const year = years[yearIdx] ?? years[years.length - 1];
  const entry = data?.meta.layers.find(l => l.id === activeLayer);
  const layerStatus = data?.layerStatus[activeLayer];

  useEffect(() => {
    if (data?.meta) store.current?.ensure(activeLayer).catch(() => {});
  }, [activeLayer, data?.meta]);
  useEffect(() => {
    if (data?.meta && (placeA || placeB)) store.current?.ensureAll();
  }, [data?.meta, placeA?.id, placeB?.id]);

  const missingYears = useMemo(() => activeLayer === 'water' ? unavailableYears(layer) : [], [layer, activeLayer]);
  const layerOptions = useMemo(() => (data?.meta.layers || []).map((l) => ({
    id: l.id, label: LAYER_STYLE[l.id].short, accent: LAYER_STYLE[l.id].accent,
  })), [data?.meta, lang]);

  // ---- Textura del globo ---------------------------------------------------
  useEffect(() => {
    if (!tex || !layer || yearIdx == null) return;
    tex.render({ layer, yearIndex: Math.min(yearIdx, layer.ny - 1), mode: settings.colorMode, sigOnly: settings.sigOnly, landOnly: settings.landOnly });
  }, [tex, layer, yearIdx, settings.colorMode, settings.sigOnly, settings.landOnly]);

  // ---- Animación de la línea de tiempo -------------------------------------
  useEffect(() => {
    if (!playing || !years.length) return undefined;
    const id = setInterval(() => setYearIdx((i) => (i + 1) % years.length), 650);
    return () => clearInterval(id);
  }, [playing, years.length]);

  const flash = useCallback((msg, ms = 4200) => {
    setToast(msg);
    clearTimeout(flash.t);
    flash.t = setTimeout(() => setToast(null), ms);
  }, []);

  // El aviso se ubica siempre justo encima del dock de la línea de tiempo (nunca lo tapa)
  const toastRef = useRef();
  useLayoutEffect(() => {
    const el = toastRef.current;
    if (!el) return;
    const dock = document.querySelector('.timeline');
    const top = dock ? dock.getBoundingClientRect().top : window.innerHeight - 24;
    el.style.bottom = `${Math.max(16, window.innerHeight - top + 12)}px`;
  }, [toast]);

  // ---- Lugares -------------------------------------------------------------
  const makePlace = useCallback(
    (lat, lon, name) => {
      const desc = geo.describe(lat, lon);
      let label = name;
      if (!label) {
        const near = data.cases.flatMap((c) => [c.a, c.b]).find((p) => greatCircleKm(p, { lat, lon }) < 150);
        label = near ? near.name : desc.country ? `${desc.country}` : desc.label;
      }
      return {
        id: ++uid,
        lat,
        lon,
        name: label,
        sub: null,
        note: t('{c} · data from the nearest {r}° grid cell', { c: desc.continentLabel || t('Ocean'), r: layer?.grid.res || data.meta.grid.res }),
      };
    },
    [geo, data, layer],
  );

  const flyPair = useCallback((a, b) => {
    const m = midpoint(a, b);
    const d = greatCircleKm(a, b);
    globe.current?.flyTo(m.lat, m.lon, Math.min(3.3, 1.7 + (d / 20000) * 2.4), 1800);
  }, []);

  const runOpposite = useCallback(async (a, layerId = activeLayer) => {
    const request = ++mirrorRequest.current;
    clearTimeout(mirrorFlightTimer.current);
    setPlaceB(null); setTagB(null);
    try {
      const L = await store.current.ensure(layerId);
      await geo.prepareLandMask(L.grid, () => request !== mirrorRequest.current);
      if (request !== mirrorRequest.current) return;
      const opp = findOpposite(L, a, placeLayerData(L, a.lat, a.lon), geo);
      if (!opp) { flash(t('No place with the opposite trend was found for this layer.')); return; }
      const b = makePlace(opp.lat, opp.lon, opp.country);
      b.sub = t('Strongest opposite {noun} trend on another part of the planet', { noun: LAYER_STYLE[layerId].noun });
      setPlaceB(b); setTagB(MIRROR_TAG);
      if (opp.anyDirection) flash(t('Place A has no clear trend, so we show the strongest contrast on the planet.'));
      globe.current?.holdNavigation(3100);
      globe.current?.flyTo(b.lat, b.lon, 2.2, 1100);
      mirrorFlightTimer.current = setTimeout(() => { if (request === mirrorRequest.current) flyPair(a, b); }, 1250);
    } catch { if (request === mirrorRequest.current) flash(t('Could not load this comparison. Retry the layer.')); }
  }, [activeLayer, geo, makePlace, flyPair, flash]);

  const retryLayer = useCallback(async id => {
    try {
      await store.current.ensure(id, { retry: true });
      if (mode === 'opposite' && placeA && id === activeLayer) runOpposite(placeA, id);
    } catch { /* the per-layer Retry action stays available */ }
  }, [mode, placeA, activeLayer, runOpposite]);

  const handleGlobeClick = useCallback(
    (lat, lon, name) => {
      if (!data || !geo || tour != null || globe.current?.isFlying()) return;
      setTouched(true);
      setWelcome(false);
      setExamplesOpen(false);
      setSettings((s) => (s.autoRotate ? { ...s, autoRotate: false } : s));
      const p = makePlace(lat, lon, name);
      if (mode === 'explore') {
        setPlaceA(p);
        setPlaceB(null);
        globe.current?.flyTo(lat, lon, 2.0, 1100);
      } else if (mode === 'versus') {
        const target = !placeA ? 'A' : !placeB ? 'B' : slot;
        if (target === 'A') {
          setPlaceA(p);
          if (placeB) flyPair(p, placeB);
          setSlot('B');
        } else {
          setPlaceB(p);
          setTagB(null);
          if (placeA) flyPair(placeA, p);
        }
      } else {
        setPlaceA(p);
        runOpposite(p);
      }
    },
    [data, geo, tour, mode, placeA, placeB, slot, makePlace, flyPair, runOpposite],
  );

  const applyCase = useCallback(
    (id) => {
      if (placeA && globe.current?.isFlying()) return;
      const c = data.cases.find((x) => x.id === id);
      if (!c) return;
      setSettings((s) => ({ ...s, autoRotate: false }));
      mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
      setActiveLayer(c.layer);
      setMode('versus');
      const a = makePlace(c.a.lat, c.a.lon, c.a.name);
      const b = makePlace(c.b.lat, c.b.lon, c.b.name);
      setPlaceA(a);
      setPlaceB(b);
      setTagB(null);
      setSlot('B');
      setSettingsOpen(false);
      setWelcome(false);
      setTour(null);
      setTouched(true);
      setExamplesOpen(false);
      flash(`${t('Example')}: ${tf(c, 'title')}. ${tf(c, 'summary')}`);
      flyPair(a, b);
    },
    [data, placeA, makePlace, flyPair, flash],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      flash(t('Your browser cannot share its location. Try searching instead.'));
      return;
    }
    flash(t('Finding your location…'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setToast(null);
        handleGlobeClick(pos.coords.latitude, pos.coords.longitude, t('My location'));
      },
      (err) => {
        const why =
          err.code === 1
            ? t('Location access is blocked for this site. Allow location in your browser permissions, or search for a city instead.')
            : err.code === 3
              ? t('Finding your location took too long.')
              : t('Your device could not determine its location right now (no Wi-Fi/GPS fix).');
        flash(`${why}${err.code === 1 ? '' : ` ${t('Search for your city instead.')}`}`, 7000);
        setSearchOpen(true);
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
  }, [handleGlobeClick, flash]);

  const shareLink = useCallback(async () => {
    const ok = await copyLink();
    flash(ok ? t('Link copied. Anyone who opens it sees exactly this view.') : t('Could not copy. Copy the address bar instead.'));
  }, [flash]);

  // ---- Enlace compartible: restaurar desde la URL una sola vez ---------------
  useEffect(() => {
    if (restored.current || !data || !geo || !tex) return;
    const s = readShareState();
    if (!s) { restored.current = true; return; }
    const lid = data.meta.layers.some(l => l.id === s.layer) ? s.layer : activeLayer;
    const L = data.layers[lid];
    if (!L) { setActiveLayer(lid); return; }
    restored.current = true;
    setActiveLayer(lid);
    if (s.year && L.years.includes(s.year)) setYearIdx(L.years.indexOf(s.year));
    if (s.view) setSettings((x) => ({ ...x, colorMode: s.view }));
    setSettings((x) => ({ ...x, autoRotate: false }));
    setWelcome(false);
    setTouched(true);
    setExamplesOpen(false);
    const a = makePlace(s.a.lat, s.a.lon, s.a.name);
    const m = s.mode || (s.b ? 'versus' : 'explore');
    setMode(m);
    setPlaceA(a);
    if (s.b && m !== 'explore') {
      const b = makePlace(s.b.lat, s.b.lon, s.b.name);
      setPlaceB(b);
      setTagB(m === 'opposite' ? MIRROR_TAG : null);
      setSlot('B');
      flyPair(a, b);
    } else {
      globe.current?.flyTo(a.lat, a.lon, 2.0, 1400);
    }
  }, [data, geo, tex, makePlace, flyPair, activeLayer]);

  // ---- Enlace compartible: mantener la URL al día ---------------------------
  useEffect(() => {
    if (!restored.current || tour != null) return;
    writeShareState({ placeA, placeB, layer: activeLayer, mode, year, view: settings.colorMode });
  }, [placeA, placeB, activeLayer, mode, year, settings.colorMode, tour]);

  const changeMode = useCallback(
    (m) => {
      mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
      setMode(m);
      setExamplesOpen(false);
      if (m === 'explore') {
        setPlaceB(null);
      } else if (m === 'opposite' && placeA) {
        runOpposite(placeA);
      } else if (m === 'versus') {
        setSlot(placeA ? 'B' : 'A');
        if (tagB === MIRROR_TAG && placeB) setTagB(null);
      }
    },
    [placeA, placeB, tagB, runOpposite],
  );

  const pickLayer = useCallback(
    (id) => {
      mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
      setActiveLayer(id);
      if (mode === 'opposite' && placeA) runOpposite(placeA, id);
    },
    [mode, placeA, runOpposite],
  );

  // ---- Recorrido guiado ----------------------------------------------------
  const tourCase = useMemo(() => data && (data.cases.find((c) => c.tour) || data.cases[0]), [data]);

  const tourPlaces = useMemo(() => {
    if (!tourCase || !geo) return null;
    return { a: makePlace(tourCase.a.lat, tourCase.a.lon, tourCase.a.name), b: makePlace(tourCase.b.lat, tourCase.b.lon, tourCase.b.name) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourCase, geo, !!layer]);

  const goTourStep = useCallback(
    (i) => {
      if (!tourPlaces) return;
      const { a, b } = tourPlaces;
      setTour(i);
      setSettingsOpen(false);
      if (i <= 1) {
        setMode('explore');
        setPlaceA(a);
        setPlaceB(null);
        globe.current?.flyTo(a.lat, a.lon, 2.0, 1300);
      } else {
        setMode('versus');
        setPlaceA(a);
        setPlaceB(b);
        setTagB(null);
        setSlot('B');
        flyPair(a, b);
      }
    },
    [tourPlaces, flyPair],
  );

  const startTour = useCallback(async () => {
    if (!tourCase) return;
    setWelcome(false); setExamplesOpen(false); setPlaying(false);
    mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
    setSettings(s => ({ ...s, autoRotate: false })); setActiveLayer(tourCase.layer);
    try { await store.current.ensure(tourCase.layer); setYearIdx(years.length - 1); goTourStep(0); }
    catch { flash(t('The example could not load. Retry its layer and start the tour again.')); }
  }, [tourCase, years.length, goTourStep, flash]);

  const endTour = useCallback(() => {
    mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
    setTour(null);
    setMode('explore');
    setPlaceA(null);
    setPlaceB(null);
    setTouched(false);
    globe.current?.flyTo(-8, -35, 2.35, 1400);
  }, []);

  const tourSteps = useMemo(() => {
    if (!tourCase || !tourPlaces || !data) return [];
    const lid = data.layers[tourCase.layer] ? tourCase.layer : activeLayer;
    const L = data.layers[lid];
    if (!L) return [];
    const st = LAYER_STYLE[lid];
    const dA = placeLayerData(L, tourPlaces.a.lat, tourPlaces.a.lon);
    const dB = placeLayerData(L, tourPlaces.b.lat, tourPlaces.b.lon);
    const hA = plainTrend(lid, dA).text;
    const hB = plainTrend(lid, dB).text;
    const span = `${L.years[0]}–${L.years[L.years.length - 1]}`;
    return [
      {
        title: t('This is {name}', { name: tourCase.a.name }),
        body: t(
          st.chart === 'bars'
            ? 'The place panel shows {n} years of NASA satellite data for this spot ({span}). Each bar is one year of {noun}. The globe shows the selected year relative to each cell’s average, or its long-term trend.'
            : 'The place panel shows {n} years of NASA satellite data for this spot ({span}). Each point is one year of {noun}. The globe shows the selected year relative to each cell’s average, or its long-term trend.',
          { n: L.years.length, span, noun: st.noun },
        ),
      },
      {
        title: t('Real trend, or just noise?'),
        body: dA?.sig
          ? t('{h}. The dashed line on the chart is the trend. A statistical test (Mann-Kendall, with FDR correction) found evidence of a sustained change, so the green label under the headline says "Evidence of a long-term trend".', { h: hA })
          : t('Rain and temperature go up and down every year. The dashed line is the trend, and a statistical test checks for evidence of a sustained change. For this period: {h} — not enough evidence yet to call it a long-term trend.', { h: hA.toLowerCase() }),
      },
      {
        title: t('Now compare with {name}', { name: tourCase.b.name }),
        body: t('{name}: {h}. The arc links both places. COMPARE mode lets you put any two places side by side, and MIRROR mode finds a place changing the opposite way for you.', {
          name: tourCase.b.name,
          h: `${hB.charAt(0).toLowerCase()}${hB.slice(1)}`,
        }),
      },
      {
        title: t('Your turn!'),
        body: t('Click anywhere on the planet (your city, a desert, a rainforest) to see its trend. You can also press Space to watch the years go by, or open Examples in the top-right corner.'),
      },
    ];
  }, [tourCase, tourPlaces, data, activeLayer, lang]);

  // ---- Celular: tamaño de pantalla y hoja de lugares -------------------------
  useEffect(() => {
    const mp = window.matchMedia(PHONE_MQ);
    const ml = window.matchMedia(LAND_MQ);
    const on = () => {
      setIsPhone(mp.matches);
      setIsLand(ml.matches);
    };
    mp.addEventListener('change', on);
    ml.addEventListener('change', on);
    return () => {
      mp.removeEventListener('change', on);
      ml.removeEventListener('change', on);
    };
  }, []);
  useEffect(() => {
    setSheetOpen(true);
    if (!placeB) setSheetSide('A');
  }, [placeA?.id]);
  useEffect(() => {
    if (placeB) {
      setSheetSide('B');
      setSheetOpen(true);
    }
  }, [placeB?.id]);
  useEffect(() => {
    if (tour != null) setSheetOpen(true);
  }, [tour]);

  // ---- Teclado -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setSearchOpen(true);
        setSettingsOpen(false);
        setExamplesOpen(false);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') setYearIdx((i) => Math.min(years.length - 1, (i ?? 0) + 1));
      else if (e.key === 'ArrowLeft') setYearIdx((i) => Math.max(0, (i ?? 0) - 1));
      else if (e.key === '1') changeMode('explore');
      else if (e.key === '2') changeMode('versus');
      else if (e.key === '3') changeMode('opposite');
      else if (e.key === 'Escape') {
        if (langOpen) setLangOpen(false);
        else if (searchOpen) setSearchOpen(false);
        else if (tour != null) endTour();
        else if (examplesOpen) setExamplesOpen(false);
        else if (welcome) setWelcome(false);
        else if (settingsOpen) setSettingsOpen(false);
        else {
          mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
          setPlaceA(null);
          setPlaceB(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [years.length, changeMode, settingsOpen, tour, welcome, endTour, examplesOpen, searchOpen, langOpen]);

  // ---- Render --------------------------------------------------------------
  if (error) return <ErrorScreen onRetry={() => setLoadAttempt(n => n + 1)} />;

  const style = LAYER_STYLE[activeLayer];
  const legendSource = layer || entry;
  const legendScale = legendSource
    ? settings.colorMode === 'trend'
      ? `±${(legendSource.viz?.trendScale ?? legendSource.stats?.slopeAbsP95 ?? 0).toFixed(activeLayer === 'temp' ? 3 : 1)} ${t(activeLayer === 'precip' ? 'mm/yr per year' : activeLayer === 'temp' ? '°C/yr' : activeLayer === 'water' ? 'cm/yr' : 'pts/yr')}`
      : `±${(legendSource.viz?.anomScale ?? legendSource.stats?.anomAbsP95 ?? 0).toFixed(activeLayer === 'temp' ? 2 : 0)} ${style.units}`
    : '';

  // Compare paso a paso: mientras falta un lugar, guía arriba; en celular el panel A espera a que elijas B
  const pickingCompare = mode === 'versus' && tour == null && !welcome && (!placeA || !placeB);
  const waitB = isPhone && mode === 'versus' && tour == null && placeA && !placeB;
  const showA = !!placeA && !waitB && (!isPhone || ((!placeB || sheetSide === 'A') && sheetOpen));
  const showB = !!placeB && (!isPhone || (sheetSide === 'B' && sheetOpen));
  const showSheetBar = isPhone && !!placeA && !waitB;
  const sheetUp = isPhone && (showA || showB);

  return (
    <div
      className={`app ${placeA || placeB ? 'has-panel' : ''} ${tour != null ? 'touring' : ''} ${isPhone ? 'phone' : ''} ${isLand ? 'land' : ''} ${sheetUp ? 'sheet-open' : ''}`}
    >
      <div className="space-bg" />
      {tex && (
        <GlobeView
          ref={globe}
          texture={tex.texture}
          textureController={tex}
          playIntro={!initialShare.current}
          overlayTexture={tex.overlayTexture}
          placeA={placeA}
          placeB={placeB}
          cases={data.cases}
          showCases={settings.showCases}
          autoRotate={settings.autoRotate}
          cinematic={false}
          onGlobeClick={handleGlobeClick}
          onCaseClick={applyCase}
          lang={lang}
        />
      )}

      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}assets/earthtrends-symbol.svg`} alt="" width="38" height="38" />
          <b>Earth<span>Trends</span></b>
        </div>

        <LiquidTabs className="modes glass" label={t('Mode')} options={MODE_OPTIONS} value={mode} onChange={changeMode} />

        <div className="top-actions">
          <button
            className={`icon-sq ${searchOpen ? 'on' : ''}`}
            onClick={() => {
              setSearchOpen((o) => !o);
              setSettingsOpen(false);
              setExamplesOpen(false);
            }}
            aria-label={t('Search a place')}
            title={t('Search a place (/)')}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M20 20l-4.2-4.2" />
            </svg>
          </button>
          <button
            className={`icon-sq ${examplesOpen ? 'on' : ''}`}
            onClick={() => {
              setExamplesOpen((o) => !o);
              setSettingsOpen(false);
              setSearchOpen(false);
            }}
            aria-label={t('Examples')}
            title={t('Examples')}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
              <circle cx="12" cy="10" r="2.3" />
            </svg>
          </button>
          <div className="lang-wrap">
            <button
              className={`icon-sq ${langOpen ? 'on' : ''}`}
              onClick={() => {
                setLangOpen((o) => !o);
                setSettingsOpen(false);
                setExamplesOpen(false);
                setSearchOpen(false);
              }}
              aria-label={t('Language')}
              aria-haspopup="menu"
              aria-expanded={langOpen}
              title={t('Language')}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9s1.3-6.4 3.9-9z" />
              </svg>
              <span className="lang-code">{lang.toUpperCase()}</span>
            </button>
            {langOpen && (
              <div className="lang-menu glass" role="menu">
                {LANGS.map(([id, label]) => (
                  <button key={id} role="menuitemradio" aria-checked={lang === id} className={lang === id ? 'on' : ''} onClick={() => changeLang(id)}>
                    <span>{label}</span>
                    {lang === id && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="icon-sq" onClick={() => setWelcome(true)} aria-label={t('What is this?')} title={t('What is this?')}>
            <span className="q">?</span>
          </button>
          <button
            className={`icon-sq ${settingsOpen ? 'on' : ''}`}
            onClick={() => {
              setSettingsOpen((o) => !o);
              setExamplesOpen(false);
              setSearchOpen(false);
            }}
            aria-label={t('Settings')}
            title={t('Settings')}
          >
            <svg className="gear-ic" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {mode === 'versus' && placeA && placeB && tour == null && (
        <div className="slot-pick glass">
          {t('Next click replaces:')}
          <button className={slot === 'A' ? 'on a' : 'a'} onClick={() => setSlot('A')}>
            {t('PLACE A')}
          </button>
          <button className={slot === 'B' ? 'on b' : 'b'} onClick={() => setSlot('B')}>
            {t('PLACE B')}
          </button>
        </div>
      )}
      {pickingCompare && (
        <div className="compare-guide glass" role="status">
          <div className="cg-steps">
            <span className={`cg-step a ${placeA ? 'done' : 'on'}`}>
              <b>1</b> {placeA ? `${placeA.name} ✓` : t('Place A')}
            </span>
            <span className="cg-arrow">→</span>
            <span className={`cg-step b ${placeA ? 'on' : ''}`}>
              <b>2</b> {t('Place B')}
            </span>
          </div>
          <p>{placeA ? t('Now tap a second place on the globe to compare.') : t('Tap a first place on the globe, then a second one.')}</p>
          {placeA && (
            <button
              className="cg-reset"
              onClick={() => {
                setPlaceA(null);
                setSlot('A');
              }}
            >
              {t('Change place A')}
            </button>
          )}
        </div>
      )}
      {showSheetBar && (
        <div className={`sheet-bar glass ${sheetOpen ? 'open' : ''}`}>
          {placeB ? (
            <div className="sheet-tabs" role="tablist">
              {[
                ['A', placeA],
                ['B', placeB],
              ].map(([s, p]) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={sheetSide === s}
                  className={`${s.toLowerCase()} ${sheetSide === s ? 'on' : ''}`}
                  onClick={() => {
                    setSheetSide(s);
                    setSlot(s); // el próximo toque en el globo reemplaza el lugar que estás viendo
                    setSheetOpen(true);
                  }}
                >
                  <b>{s}</b> {p.name}
                </button>
              ))}
            </div>
          ) : (
            <span className="sheet-title">
              <b>A</b> {placeA.name}
            </span>
          )}
          <button className="sheet-toggle" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen}>
            {sheetOpen ? `${t('Globe')} ▾` : `${t('Details')} ▴`}
          </button>
        </div>
      )}
      {toast && (
        <div ref={toastRef} className="toast glass" role="status">
          {toast}
        </div>
      )}
      {data && geo && (
        <SearchBox
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          geo={geo}
          lang={lang}
          cases={data.cases}
          onPick={(lat, lon, name) => {
            setWelcome(false);
            handleGlobeClick(lat, lon, name);
          }}
          onLocate={() => {
            setWelcome(false);
            locate();
          }}
        />
      )}

      {data && showA && (
        <PlacePanel
          key={`A-${placeA.id}`}
          side="A"
          place={placeA}
          layers={data.layers}
          meta={data.meta}
          layerStatus={data.layerStatus}
          onRetryLayer={retryLayer}
          geo={geo}
          activeLayer={activeLayer}
          year={year}
          onPickLayer={pickLayer}
          onShare={shareLink}
          onClose={() => {
            mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current);
            setPlaceA(null); setPlaceB(null);
          }}
        />
      )}
      {data && showB && (
        <PlacePanel
          key={`B-${placeB.id}`}
          side="B"
          place={placeB}
          layers={data.layers}
          meta={data.meta}
          layerStatus={data.layerStatus}
          onRetryLayer={retryLayer}
          geo={geo}
          activeLayer={activeLayer}
          year={year}
          tag={tagB}
          onPickLayer={pickLayer}
          onShare={shareLink}
          onClose={() => { mirrorRequest.current++; clearTimeout(mirrorFlightTimer.current); setPlaceB(null); }}
        />
      )}

      {data && (
        <Timeline
          years={years}
          year={year}
          missingYears={missingYears}
          onYear={(y) => {
            setPlaying(false);
            setYearIdx(years.indexOf(y));
          }}
        >
          <div className="dock-legend">
            <div className="dock-top">
          <LiquidTabs className="legend-layers" label={t('Climate layer')} options={layerOptions} value={activeLayer} onChange={pickLayer} />

            </div>
          <div className="legend-bar" role="img"
            aria-label={settings.colorMode === 'trend' ? t('Trend per year, {a}–{b}', { a: years[0], b: years[years.length - 1] }) : t('{y} vs. {a}–{b} average', { y: year, a: years[0], b: years[years.length - 1] })}
            title={settings.colorMode === 'trend' ? t('Trend per year, {a}–{b}', { a: years[0], b: years[years.length - 1] }) : t('{y} vs. {a}–{b} average', { y: year, a: years[0], b: years[years.length - 1] })}
            style={{ background: legendGradient(activeLayer) }} />
          <div className="legend-labels">
            <span>← {style.negLabel}</span>
            <span className="legend-scale">{legendScale}</span>
            <span>{style.posLabel} →</span>
          </div>
          </div>
        </Timeline>
      )}

      {data && !layer && <div className="layer-status glass" role={layerStatus === 'error' ? 'alert' : 'status'}>
        <span>{layerStatus === 'error' ? t('{name} is unavailable.', { name: style.short }) : t('Loading {name}…', { name: style.short })}</span>
        {layerStatus === 'error' && <button type="button" onClick={() => retryLayer(activeLayer)}>{t('Retry')}</button>}
      </div>}
      {data && (
        <SettingsMenu
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          data={data}
          settings={settings}
          setSettings={setSettings}
          activeLayer={activeLayer}
          setActiveLayer={pickLayer}
          onCase={applyCase}
          onTour={startTour}
          geoReady={geoReady}
        />
      )}

      <footer className="credits">
        {t('Data:')} <a href="https://disc.gsfc.nasa.gov" target="_blank" rel="noreferrer">NASA GES DISC</a> (GPM IMERG &amp; MERRA-2) ·{' '}
        <a href="https://podaac.jpl.nasa.gov/dataset/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4" target="_blank" rel="noreferrer">NASA PO.DAAC</a> (GRACE/GRACE-FO) · 2005–2025 · Hamed–Rao Mann–Kendall + FDR
      </footer>

      {data && tex && !welcome && tour == null && examplesOpen && (
        <ExamplesDock
          cases={data.cases}
          dropdown
          onClose={() => setExamplesOpen(false)}
          onCase={(id) => {
            setExamplesOpen(false);
            applyCase(id);
          }}
          onTour={() => {
            setExamplesOpen(false);
            startTour();
          }}
        />
      )}
      {tour != null && tourSteps[tour] && (
        <TourBubble
          step={tour}
          total={tourSteps.length}
          title={tourSteps[tour].title}
          body={tourSteps[tour].body}
          last={tour === tourSteps.length - 1}
          onBack={() => goTourStep(tour - 1)}
          onNext={() => (tour === tourSteps.length - 1 ? endTour() : goTourStep(tour + 1))}
          onSkip={endTour}
        />
      )}
      {tex && welcome && (
        <Welcome
          tourCase={tourCase}
          onTour={startTour}
          onExplore={() => {
            setWelcome(false);
          }}
        />
      )}

      {!tex && <LoadingScreen message={progress} />}
    </div>
  );
}
