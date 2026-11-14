// Idiomas: el inglés es el texto base; t() lo traduce si el idioma activo es español.
// Si falta una traducción se muestra el inglés (nunca se rompe la interfaz).
import { ES } from './i18n-es.js';

export const LANGS = [
  ['en', 'English'],
  ['es', 'Español'],
];

let current = 'en';
const DICTS = { es: ES };

export function getLang() {
  return current;
}

export function setLang(lang) {
  current = DICTS[lang] || lang === 'en' ? lang : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

/** Idioma guardado por el usuario (por defecto inglés). */
export function initialLang() {
  try {
    const saved = window.localStorage.getItem('earthtrends-lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    /* almacenamiento bloqueado: inglés */
  }
  return 'en';
}

export function saveLang(lang) {
  try {
    window.localStorage.setItem('earthtrends-lang', lang);
  } catch {
    /* sin almacenamiento: solo esta sesión */
  }
}

/** Traduce un texto en inglés. Variables con {nombre}. */
export function t(text, vars) {
  let out = (current !== 'en' && DICTS[current]?.[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return out;
}

/** Campo localizado de un objeto de datos: obj.title_es si existe y el idioma es español. */
export function tf(obj, field) {
  if (!obj) return '';
  return (current !== 'en' && obj[`${field}_${current}`]) || obj[field];
}

/** Locale para números y fechas. */
export function numLocale() {
  return current === 'es' ? 'es' : 'en';
}

/** Nombre de país en el idioma activo a partir del código ISO (Intl), con respaldo al nombre en inglés. */
let regionNames = null;
let regionLang = null;
export function countryName(iso, fallback) {
  if (current === 'en' || !iso || iso.length !== 2 || iso === '-9') return fallback;
  try {
    if (regionLang !== current) {
      regionNames = new Intl.DisplayNames([current], { type: 'region' });
      regionLang = current;
    }
    return regionNames.of(iso) || fallback;
  } catch {
    return fallback;
  }
}
