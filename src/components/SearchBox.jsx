// Buscador de lugares: coordenadas, ejemplos y países (local) + ciudades/regiones (OpenStreetMap Nominatim).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { geoCentroid } from 'd3-geo';

import { searchOnline } from '../lib/geocoding.js';

function parseCoords(q) {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2] && m[2].toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() === 'W') lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Ciudades principales (Natural Earth): respuesta instantánea y sin conexión
let citiesPromise = null;
function loadCities() {
  if (!citiesPromise)
    citiesPromise = fetch(`${import.meta.env.BASE_URL}assets/cities.json`)
      .then((r) => r.json())
      .then((d) => d.cities)
      .catch(() => []);
  return citiesPromise;
}

const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function SearchBox({ open, onClose, geo, cases, onPick, onLocate }) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const [cities, setCities] = useState([]);
  const input = useRef();
  const remoteController = useRef();
  const [searchError, setSearchError] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (open) loadCities().then(setCities);
  }, [open]);

  useEffect(() => {
    if (open) input.current?.focus();
    else {
      setQ('');
      setRemote([]);
    }
  }, [open]);

  // Índice local: países (centroide) y lugares de los ejemplos
  const local = useMemo(() => {
    if (!geo) return [];
    const countries = geo.items
      .filter((it) => it.continentLabel !== 'Ocean' && it.name)
      .map((it) => {
        const [lon, lat] = geoCentroid(it.feature);
        return { name: it.name, detail: `Country · ${it.continentLabel}`, lat, lon, key: norm(it.name) };
      });
    const ex = (cases || []).flatMap((c) =>
      [c.a, c.b].map((p) => ({ name: p.name, detail: `Example · ${c.title}`, lat: p.lat, lon: p.lon, key: norm(p.name) })),
    );
    const cs = cities.map(([name, country, lat, lon]) => ({ name, detail: `City · ${country}`, lat, lon, key: norm(name) }));
    return [...ex, ...cs, ...countries];
  }, [geo, cases, cities]);

  const coords = parseCoords(q);
  const localHits = useMemo(() => {
    const k = norm(q.trim());
    if (k.length < 2) return [];
    const starts = local.filter((p) => p.key.startsWith(k));
    const contains = local.filter((p) => !p.key.startsWith(k) && p.key.includes(k));
    return [...starts, ...contains].slice(0, 6);
  }, [q, local]);

  // Typing only searches the bundled index. A remote request needs confirmation.
  useEffect(() => {
    remoteController.current?.abort(); setRemote([]); setBusy(false); setSearchError(false); setSearched(false);
    return () => remoteController.current?.abort();
  }, [q, open]);
  const lookup = async () => {
    if (q.trim().length < 3 || coords || busy) return;
    const controller = new AbortController(); remoteController.current?.abort(); remoteController.current = controller;
    setBusy(true); setSearchError(false); setSearched(true);
    try { const places = await searchOnline(q, { signal: controller.signal }); if (!controller.signal.aborted) setRemote(places); }
    catch (e) { if (e.name !== 'AbortError') setSearchError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const results = useMemo(() => {
    const out = [];
    if (coords) out.push({ name: `${coords.lat.toFixed(2)}°, ${coords.lon.toFixed(2)}°`, detail: 'Coordinates', ...coords, coordsOnly: true });
    const seen = new Set();
    for (const r of [...localHits, ...remote]) {
      const id = `${norm(r.name)}|${Math.round(r.lat)}|${Math.round(r.lon)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
    return out.slice(0, 9);
  }, [coords, localHits, remote]);

  useEffect(() => setSel(0), [results.length]);

  if (!open) return null;

  const pick = (r) => {
    onPick(r.lat, r.lon, r.coordsOnly ? null : r.name);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(results.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') { e.preventDefault(); if (results[sel]) pick(results[sel]); else lookup(); }
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="search glass" role="dialog" aria-label="Search a place">
      <div className="search-field">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="City, region, country or lat, lon"
          aria-label="Search a place"
        />
        {busy && <span className="search-spin" />}
        <button className="icon-btn" onClick={onClose} aria-label="Close search">
          ×
        </button>
      </div>

      <button
        className="search-locate"
        onClick={() => {
          onLocate();
          onClose();
        }}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        Use my location
      </button>

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r, i) => (
            <li key={`${r.name}-${r.lat}-${r.lon}`}>
              <button className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
                <b>{r.name}</b>
                <small>{r.detail}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 3 && !coords && <button type="button" className="search-online" disabled={busy} onClick={lookup}>{busy ? 'Searching…' : searchError ? 'Retry online search' : 'Search online'}</button>}
      {searchError && <p className="search-empty" role="status">Online search is unavailable. Local places and coordinates still work.</p>}
      {searched && !searchError && !busy && !results.length && <p className="search-empty">No places found. Try another spelling or coordinates like “-34.6, -58.4”.</p>}
      <p className="search-credit">
        Place search © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors (Nominatim). Online search sends the entered place name to this service.
      </p>
    </div>
  );
}
