import { cellCenter } from './data.js';
import { greatCircleKm } from './stats.js';

const median = values => { const a = values.sort((a,b) => a-b), m = Math.floor(a.length/2); return a.length % 2 ? a[m] : (a[m-1]+a[m])/2; };
export function senTrend(series) {
  const valid = series.filter(s => Number.isFinite(s.v)), slopes = [];
  for (let i=0;i<valid.length;i++) for (let j=i+1;j<valid.length;j++) if (valid[j].year > valid[i].year) slopes.push((valid[j].v-valid[i].v)/(valid[j].year-valid[i].year));
  if (!slopes.length) return null;
  const slope=median(slopes);
  return { slope, n: valid.length, firstYear: valid[0].year, lastYear: valid.at(-1).year };
}

/** Descriptive regional reference; it does not assign a new p/q value. */
export function regionalMean(layer, selectedCell, landMask, { radiusKm=500, minCells=5, minCoverage=0.75 }={}) {
  if (!layer || selectedCell == null || selectedCell<0 || selectedCell>=layer.ncell || !landMask || landMask.length !== layer.ncell) return null;
  const center=cellCenter(layer,selectedCell), land=layer.id==='water' || landMask[selectedCell]>=0;
  const candidates=[]; let totalWeight=0;
  const latRadius=radiusKm/6371*180/Math.PI, {nlat,nlon,lat0,lon0,res}=layer.grid;
  for(let r=0;r<nlat;r++) {
    const lat=lat0+r*res;
    if(Math.abs(lat-center.lat)>latRadius) continue;
    const weight=Math.cos(lat*Math.PI/180);
    for(let c=0;c<nlon;c++) {
      const cell=r*nlon+c;
      if(!layer.has[cell] || (landMask[cell]>=0)!==land) continue;
      if(greatCircleKm(center,{lat,lon:lon0+c*res})>radiusKm) continue;
      candidates.push({cell,weight}); totalWeight+=weight;
    }
  }
  if(candidates.length<minCells || !(totalWeight>0)) return null;
  const series=layer.years.map((year,t)=>{
    let sum=0,weight=0,count=0;
    for(const c of candidates) { const v=layer.values[c.cell*layer.ny+t]; if(!Number.isFinite(v)) continue; sum+=v*c.weight;weight+=c.weight;count++; }
    return {year,v:count>=minCells && weight/totalWeight>=minCoverage ? sum/weight : null,coverage:weight/totalWeight,cells:count};
  });
  const validYears=series.filter(s=>Number.isFinite(s.v)).length;
  return { center, radiusKm, cells:candidates.length, domain:land?'land':'ocean', minCoverage, series, trend:validYears>=10?senTrend(series):null };
}
