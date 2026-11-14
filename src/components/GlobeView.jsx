import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { fmtCoord } from '../lib/format.js';
import { createGlobeMaterial, installGlobeFx } from '../lib/globeFx.js';
import { adaptEarthTextures } from '../lib/textureQuality.js';
import { createFlightLock } from '../lib/cameraFlight.js';
import { cameraLatitude, installNavigationGuard } from '../lib/globeNavigation.js';

function useWindowSize() {
  const [s, setS] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setS({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

function pinElement(d, onCaseClick) {
  const el = document.createElement('div');
  if (d.kind === 'case') {
    el.className = 'pin pin-case';
    el.innerHTML = `<span class="diamond"></span><span class="case-tip">${d.label}</span>`;
    el.style.pointerEvents = 'auto';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onCaseClick(d.caseId);
    });
    return el;
  }
  el.className = `pin pin-${d.kind} ${d.right ? 'tag-right' : ''}`;
  el.innerHTML = `
    <span class="pulse"></span><span class="dot"></span>
    <div class="pin-tag"><b>${d.label.toUpperCase()}</b><small>${fmtCoord(d.lat, d.lng)}</small></div>`;
  return el;
}

const GlobeView = forwardRef(function GlobeView(
  { texture, overlayTexture, textureController, playIntro = true, placeA, placeB, cases, showCases, autoRotate, cinematic, onGlobeClick, onCaseClick, shifted },
  ref,
) {
  const globeRef = useRef();
  const introTimer = useRef();
  const rotate = useRef(autoRotate);
  rotate.current = autoRotate;
  const [flying, setFlying] = useState(false);
  const previousEnabled = useRef(true);
  const flight = useMemo(() => createFlightLock(locked => {
    const controls = globeRef.current?.controls();
    if (controls) {
      if (locked) previousEnabled.current = controls.enabled;
      controls.enabled = locked ? false : previousEnabled.current;
      controls.autoRotate = locked ? false : rotate.current;
    }
    setFlying(locked);
  }), []);
  useEffect(() => () => flight.dispose(), [flight]);
  const moveCamera = useCallback((view, ms) => {
    if (!globeRef.current) return;
    flight.hold(ms + 50);
    globeRef.current.pointOfView(view, ms);
  }, [flight]);
  const { w, h } = useWindowSize();
  const [ready, setReady] = useState(false);
  // Altitud de la cámara: anillos y arco se escalan con ella para verse siempre del mismo tamaño en pantalla
  const [alt, setAlt] = useState(2.35);
  const altRef = useRef(2.35);
  const onZoom = (pov) => {
    const a = pov?.altitude;
    if (!a || Math.abs(a - altRef.current) / altRef.current < 0.04) return;
    altRef.current = a;
    setAlt(a);
  };

  const fx = useMemo(() => (texture ? createGlobeMaterial(texture, overlayTexture) : null), [texture, overlayTexture]);
  const material = fx?.material;
  const fxCtl = useRef(null);

  // Atmósfera propia, cielo 3D, luces y día/noche
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !ready || !fx) return undefined;
    adaptEarthTextures(g.renderer(), fx.material, fx.uniforms.nightMap.value, overlayTexture);
    fxCtl.current = installGlobeFx(g, fx.uniforms);
    return () => fxCtl.current?.dispose();
  }, [ready, fx, overlayTexture]);

  useEffect(() => {
    if (!ready || !fx || !textureController) return;
    return textureController.attachRenderer(globeRef.current.renderer(), texture => {
      fx.uniforms.climateOverlay.value = texture;
    });
  }, [ready, fx, textureController]);

  useEffect(() => {
    fxCtl.current?.setCinematic(!!cinematic);
  }, [cinematic, ready]);

  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, altitude = 2.1, ms = 1400) {
      clearTimeout(introTimer.current);
      const k = window.innerWidth < 700 ? 1.45 : 1; // en móvil alejamos la cámara
      moveCamera({ lat: cameraLatitude(lat), lng, altitude: altitude * k }, ms);
    },
    isFlying: flight.isLocked,
    holdNavigation: ms => flight.hold(ms),
  }), [flight, moveCamera]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g || !ready) return;
    const controls = g.controls();
    controls.autoRotate = flight.isLocked() ? false : autoRotate;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 130;
    controls.maxDistance = 900;
  }, [autoRotate, ready, flight]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g || !ready) return undefined;
    return installNavigationGuard(g);
  }, [ready]);

  // Entrada: el planeta llega desde lejos girando
  useEffect(() => {
    if (!ready || !playIntro) return;
    const g = globeRef.current;
    const finalAlt = window.innerWidth < 700 ? 3.5 : 2.35;
    g?.pointOfView({ lat: 12, lng: -150, altitude: 9 }, 0);
    introTimer.current = setTimeout(() => moveCamera({ lat: -8, lng: -35, altitude: finalAlt }, 3200), 120);
    return () => clearTimeout(introTimer.current);
  }, [ready, moveCamera, playIntro]);

  const pins = useMemo(() => {
    const arr = [];
    if (placeA) arr.push({ kind: 'a', lat: placeA.lat, lng: placeA.lon, label: placeA.name, id: `a-${placeA.id}` });
    if (placeB) arr.push({ kind: 'b', lat: placeB.lat, lng: placeB.lon, label: placeB.name, id: `b-${placeB.id}`, right: false });
    if (showCases) {
      for (const c of cases) {
        for (const s of ['a', 'b']) {
          arr.push({ kind: 'case', lat: c[s].lat, lng: c[s].lon, label: `${c[s].name} — example: ${c.title}`, caseId: c.id, id: `${c.id}-${s}` });
        }
      }
    }
    return arr;
  }, [placeA, placeB, cases, showCases]);

  const rings = useMemo(() => {
    const r = [];
    if (placeA) r.push({ lat: placeA.lat, lng: placeA.lon, color: '62,197,255' });
    if (placeB) r.push({ lat: placeB.lat, lng: placeB.lon, color: '255,181,71' });
    return r;
  }, [placeA, placeB]);

  const arcs = useMemo(
    () => (placeA && placeB ? [{ startLat: placeA.lat, startLng: placeA.lon, endLat: placeB.lat, endLng: placeB.lon }] : []),
    [placeA, placeB],
  );

  return (
    <div className={`globe-wrap ${shifted ? 'shifted' : ''} ${flying ? 'camera-flying' : ''}`} aria-busy={flying}
      onClickCapture={e => { if (flight.isLocked()) { e.preventDefault(); e.stopPropagation(); } }}>
      <Globe
        ref={globeRef}
        width={w}
        height={h}
        backgroundColor="rgba(0,0,0,0)"
        globeMaterial={material}
        showAtmosphere={false}
        onGlobeReady={() => setReady(true)}
        onZoom={onZoom}
        onGlobeClick={({ lat, lng }) => { if (!flight.isLocked()) onGlobeClick(lat, lng); }}
        htmlElementsData={pins}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={0.012}
        htmlElement={(d) => pinElement(d, onCaseClick)}
        htmlElementVisibilityModifier={(el, visible) => {
          el.style.opacity = visible ? 1 : 0;
          el.style.pointerEvents = visible && el.classList.contains('pin-case') ? 'auto' : 'none';
        }}
        htmlTransitionDuration={0}
        ringsData={rings}
        ringColor={(d) => (t) => `rgba(${d.color},${1 - t})`}
        ringMaxRadius={1.9 * alt}
        ringPropagationSpeed={2.4}
        ringRepeatPeriod={1300}
        ringAltitude={0.004}
        arcsData={arcs}
        arcColor={() => ['rgba(62,197,255,0.95)', 'rgba(255,181,71,0.95)']}
        arcStroke={0.32 * alt}
        arcAltitudeAutoScale={0.42}
        arcDashLength={0.42}
        arcDashGap={0.08}
        arcDashInitialGap={1}
        arcDashAnimateTime={2600}
        arcsTransitionDuration={0}
      />
    </div>
  );
});

export default React.memo(GlobeView);
