/** Display-only interpolation. Never mutates observations or extrapolates endpoints. */
export function estimateInternalGaps(series) {
  const points = series.map((s, index) => ({ ...s, index, estimated: false }));
  const bridges = [];
  const valid = p => Number.isFinite(p?.v);
  for (let i = 0; i < points.length; i++) {
    if (valid(points[i])) continue;
    const start = i;
    while (i < points.length && !valid(points[i])) i++;
    const left = points[start - 1], right = points[i];
    if (!valid(left) || !valid(right) || !(right.year > left.year)) continue;
    for (let j = start; j < i; j++) {
      const t = (points[j].year - left.year) / (right.year - left.year);
      points[j] = { ...points[j], v: left.v + (right.v - left.v) * t, estimated: true };
    }
    bridges.push(points.slice(start - 1, i + 1));
  }
  return { points, bridges };
}
