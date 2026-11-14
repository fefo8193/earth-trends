// Contaminación lumínica aproximada a partir de la imagen nocturna de NASA (Black Marble / Earth at Night).
// Se muestrea el brillo medio alrededor del punto y se clasifica en niveles tipo escala de cielo oscuro.
import { t } from './i18n.js';

const SRC = `${import.meta.env.BASE_URL}assets/earth-night.jpg`;
let ready = null;
let px = null;
let W = 0;
let H = 0;

export function loadLightPollution() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 2048×1024 alcanza (~20 km por píxel) y ocupa poca memoria
      W = 2048;
      H = 1024;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, W, H);
      const d = cx.getImageData(0, 0, W, H).data;
      px = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) px[i] = Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = SRC;
  });
  return ready;
}

const LEVELS = [
  [6, 'Very low', 'excellent dark sky — the Milky Way is visible'],
  [22, 'Low', 'good dark sky for telescopes'],
  [60, 'Moderate', 'bright stars and planets; faint objects get lost'],
  [130, 'High', 'suburban glow; only the brightest stars'],
  [256, 'Very high', 'city lights; very few stars visible'],
];

/** { level, label, detail, value(0-255) } o null si la imagen no cargó todavía. */
export function lightPollutionAt(lat, lon) {
  if (!px) return null;
  const x0 = Math.floor(((lon + 180) / 360) * W);
  const y0 = Math.floor(((90 - lat) / 180) * H);
  let s = 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const y = Math.min(H - 1, Math.max(0, y0 + dy));
      const x = (((x0 + dx) % W) + W) % W;
      s += px[y * W + x];
      n++;
    }
  }
  const v = s / n;
  const i = LEVELS.findIndex(([t]) => v < t);
  const [, label, detail] = LEVELS[i < 0 ? LEVELS.length - 1 : i];
  return { level: i, label: t(label), detail: t(detail), value: Math.round(v) };
}
