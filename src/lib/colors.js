import { t } from './i18n.js';

// Paletas climáticas divergentes (centro transparente) y colores de acento por capa.
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const LAYER_STYLE = {
  precip: {
    get short() {
      return t('Rainfall');
    },
    get name() {
      return t('Rainfall');
    },
    get units() {
      return t('mm/yr');
    },
    get noun() {
      return t('rainfall');
    },
    accent: '#3ec5ff',
    chart: 'bars',
    neg: [hex('#ffc070'), hex('#d9461b')], // más seco
    pos: [hex('#6fdcff'), hex('#2a62ff')], // más húmedo
    get negLabel() {
      return t('drier');
    },
    get posLabel() {
      return t('wetter');
    },
    get about() {
      return t("How much rain and snow fell during the year, measured from space by NASA's GPM satellites (IMERG). One millimetre means a 1 mm layer of water over flat ground.");
    },
  },
  temp: {
    get short() {
      return t('Temperature');
    },
    get name() {
      return t('Temperature');
    },
    get units() {
      return t('°C');
    },
    get noun() {
      return t('temperature');
    },
    accent: '#ffb547',
    chart: 'area',
    neg: [hex('#b8f3ff'), hex('#22d3ee')],
    pos: [hex('#ffc46b'), hex('#ff3a2a')],
    get negLabel() {
      return t('colder');
    },
    get posLabel() {
      return t('warmer');
    },
    get about() {
      return t("Average air temperature 2 metres above the ground, from NASA's MERRA-2 reanalysis: a model that blends satellite, weather-station and balloon observations into one complete map.");
    },
  },
  water: {
    get short() {
      return t('Water');
    },
    get name() {
      return t('Water storage (GRACE)');
    },
    get units() {
      return t('cm');
    },
    get noun() {
      return t('water storage');
    },
    accent: '#a9c8ff',
    chart: 'area',
    neg: [hex('#ffd27a'), hex('#d97a1c')],
    pos: [hex('#7ff5e6'), hex('#169fd6')],
    get negLabel() {
      return t('less water');
    },
    get posLabel() {
      return t('more water');
    },
    get about() {
      return t("All the water stored on and under the land (lakes, rivers, soil moisture, groundwater, snow and ice). The twin GRACE and GRACE-FO satellites weigh it from space through tiny changes in Earth's gravity. Shown in centimetres of water compared with the 2004–2009 average.");
    },
  },
  stars: {
    get short() {
      return t('Stars');
    },
    get name() {
      return t('Star visibility');
    },
    get units() {
      return t('% clear sky');
    },
    get noun() {
      return t('clear-sky time');
    },
    accent: '#c6b3ff',
    chart: 'area',
    neg: [hex('#d9b8ff'), hex('#8a4fe0')], // más nublado
    pos: [hex('#fff3b0'), hex('#ffcf3a')], // más despejado
    get negLabel() {
      return t('cloudier');
    },
    get posLabel() {
      return t('clearer skies');
    },
    get about() {
      return t("The share of time the sky is free of clouds, from MERRA-2 total cloud cover. Together with NASA's Earth at Night image (light pollution), it tells you how good a place is for stargazing.");
    },
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
