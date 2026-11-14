// Paletas climáticas divergentes (centro transparente) y colores de acento por capa.
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const LAYER_STYLE = {
  precip: {
    short: 'Rainfall',
    name: 'Rainfall',
    units: 'mm/yr',
    noun: 'rainfall',
    accent: '#3ec5ff',
    chart: 'bars',
    neg: [hex('#ffc070'), hex('#d9461b')], // más seco
    pos: [hex('#6fdcff'), hex('#2a62ff')], // más húmedo
    negLabel: 'drier',
    posLabel: 'wetter',
  },
  temp: {
    short: 'Temperature',
    name: 'Temperature',
    units: '°C',
    noun: 'temperature',
    accent: '#ffb547',
    chart: 'area',
    neg: [hex('#b8f3ff'), hex('#22d3ee')],
    pos: [hex('#ffc46b'), hex('#ff3a2a')],
    negLabel: 'colder',
    posLabel: 'warmer',
  },
  water: {
    short: 'Water',
    name: 'Water storage (GRACE)',
    units: 'cm',
    noun: 'water storage',
    accent: '#a9c8ff',
    chart: 'area',
    neg: [hex('#ffd27a'), hex('#d97a1c')],
    pos: [hex('#7ff5e6'), hex('#169fd6')],
    negLabel: 'less water',
    posLabel: 'more water',
  },
  stars: {
    short: 'Stars',
    name: 'Star visibility',
    units: '% clear sky',
    noun: 'clear-sky time',
    accent: '#c6b3ff',
    chart: 'area',
    neg: [hex('#d9b8ff'), hex('#8a4fe0')], // más nublado
    pos: [hex('#fff3b0'), hex('#ffcf3a')], // más despejado
    negLabel: 'cloudier',
    posLabel: 'clearer skies',
  },
};

/** n en [-1, 1] → [r, g, b, a(0-255)] */
export function divergingRGBA(layerId, n) {
  const s = LAYER_STYLE[layerId] || LAYER_STYLE.precip;
  const a = Math.min(1, Math.abs(n));
  const [c1, c2] = n < 0 ? s.neg : s.pos;
  const r = c1[0] + (c2[0] - c1[0]) * a;
  const g = c1[1] + (c2[1] - c1[1]) * a;
  const b = c1[2] + (c2[2] - c1[2]) * a;
  const alpha = Math.pow(Math.min(1, a * 1.15), 0.85) * 235;
  return [r, g, b, alpha];
}

export function legendGradient(layerId) {
  const s = LAYER_STYLE[layerId];
  const css = (c) => `rgb(${c.join(',')})`;
  return `linear-gradient(90deg, ${css(s.neg[1])}, ${css(s.neg[0])} 35%, rgba(255,255,255,0.08) 50%, ${css(s.pos[0])} 65%, ${css(s.pos[1])})`;
}
