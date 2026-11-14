// Países (Natural Earth 110m) para nombrar lugares, máscara tierra/océano y contornos del globo.
import { geoArea, geoBounds, geoContains } from 'd3-geo';


function rewind(feature) {
  // d3-geo usa la convención inversa a RFC7946: si el área da > hemisferio, invertimos los anillos.
  if (geoArea(feature) <= 2 * Math.PI) return feature;
  const g = feature.geometry;
  const rev = (rings) => rings.map((r) => r.slice().reverse());
  const geometry =
    g.type === 'Polygon' ? { ...g, coordinates: rev(g.coordinates) } : { ...g, coordinates: g.coordinates.map(rev) };
  return { ...feature, geometry };
}

export async function loadGeo({ signal } = {}) {
  const res = await fetch(`${import.meta.env.BASE_URL}assets/countries.geojson`, { signal });
  if (!res.ok) throw new Error('Geographic data is unavailable');
  const fc = await res.json();
  const features = fc.features.map(rewind);
  const items = features.map((f) => {
    const [[x0, y0], [x1, y1]] = geoBounds(f);
    const name = f.properties.NAME || f.properties.ADMIN;
    return {
      feature: f,
      name,
      continent: f.properties.CONTINENT,
      continentLabel: f.properties.CONTINENT === 'Seven seas (open ocean)' ? 'Ocean' : f.properties.CONTINENT,
      bbox: [x0, y0, x1, y1],
    };
  });
  const masks = new Map();

  function lookup(lat, lon) {
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const [x0, y0, x1, y1] = it.bbox;
      if (lat < y0 - 0.01 || lat > y1 + 0.01) continue;
      const inLon = x0 <= x1 ? lon >= x0 - 0.01 && lon <= x1 + 0.01 : lon >= x0 || lon <= x1;
      if (!inLon) continue;
      if (geoContains(it.feature, [lon, lat])) return k;
    }
    return -1;
  }

  return {
    collection: { type: 'FeatureCollection', features },
    items,
    lookup,
    describe(lat, lon) {
      const k = lookup(lat, lon);
      if (k < 0) return { country: null, continent: null, label: oceanName(lat, lon) };
      return { country: items[k].name, continent: items[k].continent, continentLabel: items[k].continentLabel, label: items[k].name };
    },
    async prepareLandMask(grid, cancelled = () => false) {
      const key = `${grid.res}:${grid.nlat}:${grid.nlon}:${grid.lat0}:${grid.lon0}`;
      if (masks.has(key)) return masks.get(key);
      const m = new Int16Array(grid.nlat * grid.nlon);
      let start = performance.now();
      for (let i = 0; i < grid.nlat; i++) {
        if (cancelled()) return null;
        const lat = grid.lat0 + i * grid.res;
        for (let j = 0; j < grid.nlon; j++) m[i * grid.nlon + j] = lookup(lat, grid.lon0 + j * grid.res);
        if (performance.now() - start > 5) {
          await new Promise(resolve => setTimeout(resolve, 0));
          start = performance.now();
        }
      }
      masks.set(key, m);
      return m;
    },
    /** Int16Array: índice de país por celda (-1 = océano). Cacheado por resolución. */
    landMask(grid) {
      const key = `${grid.res}:${grid.nlat}:${grid.nlon}:${grid.lat0}:${grid.lon0}`;
      if (masks.has(key)) return masks.get(key);
      const m = new Int16Array(grid.nlat * grid.nlon);
      for (let i = 0; i < grid.nlat; i++) {
        const lat = grid.lat0 + i * grid.res;
        for (let j = 0; j < grid.nlon; j++) m[i * grid.nlon + j] = lookup(lat, grid.lon0 + j * grid.res);
      }
      masks.set(key, m);
      return m;
    },
  };
}

function oceanName(lat, lon) {
  if (lat < -60) return 'Southern Ocean';
  if (lat > 66) return 'Arctic Ocean';
  if (lon > -70 && lon < 20) return 'Atlantic Ocean';
  if (lon >= 20 && lon < 120 && lat < 25) return 'Indian Ocean';
  return 'Pacific Ocean';
}
