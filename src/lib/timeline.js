/** Nearest real year; works even when a dataset's year list is irregular. */
export function nearestYear(years, value) {
  return years.reduce((best, y) => Math.abs(y - value) < Math.abs(best - value) ? y : best, years[0]);
}

/** Missing annual products, derived from data rather than a hardcoded mission date. */
export function unavailableYears(layer) {
  if (!layer) return [];
  return layer.years.filter((_, t) => {
    for (let c = 0; c < layer.ncell; c++) {
      if (Number.isFinite(layer.values[c * layer.ny + t])) return false;
    }
    return true;
  });
}

export function yearGroups(years) {
  const groups = [];
  for (const year of years) {
    const last = groups[groups.length - 1];
    if (last && year === last.end + 1) last.end = year;
    else groups.push({ start: year, end: year });
  }
  return groups;
}

export const yearGroupLabel = ({ start, end }) => start === end ? `${start}` : `${start}–${end}`;

/** A small dead band keeps pointer noise from flipping between two adjacent years. */
export function magneticYear(years, value, previous) {
  const next = nearestYear(years, value);
  if (!years.includes(previous) || next === previous) return next;
  const boundary = (previous + next) / 2;
  const margin = Math.min(0.1, Math.abs(next - previous) * 0.1);
  return next > previous
    ? (value >= boundary + margin ? next : previous)
    : (value <= boundary - margin ? next : previous);
}
