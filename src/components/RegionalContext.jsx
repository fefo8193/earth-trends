import React,{useEffect,useMemo,useState}from'react';
import{regionalMean}from'../lib/regional.js';
import{fmtValue,fmtSlope}from'../lib/format.js';
import{t}from'../lib/i18n.js';
const difference=(id,v)=>`${v>0?'+':v<0?'−':''}${Math.abs(v).toFixed(id==='temp'?2:id==='precip'?0:1)} ${id==='temp'?'°C':id==='precip'?'mm':id==='stars'?t('percentage points'):'cm'}`;
export default function RegionalContext({layer,placeData,year,geo}) {
  const[maskState,setMask]=useState(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const key=layer?JSON.stringify(layer.grid):'';
  useEffect(()=>{let alive=true;setFailed(false);if(layer&&geo)geo.prepareLandMask(layer.grid,()=>!alive).then(mask=>{if(alive)setMask({key,mask});}).catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[layer?.grid,geo,key,attempt]);
  const mask=maskState?.key===key?maskState.mask:null;
  const region=useMemo(()=>mask&&placeData?regionalMean(layer,placeData.cell,mask):null,[layer,placeData?.cell,mask]);
  if(!layer||!placeData) return null;
  const observation=placeData.series.find(s=>s.year===year)?.v,average=region?.series.find(s=>s.year===year)?.v;
  const observed=Number.isFinite(observation)&&Number.isFinite(average);
  return <details className="regional-context">
    <summary><span>{t('Nearby region')} <small>500 km</small></span><span className="region-preview">{failed?t('Regional context unavailable'):!mask?t('Preparing regional context…'):!region?t('Not enough matched cells'):Number.isFinite(average)?t('{y} average: {v}',{y:year,v:fmtValue(layer.id,average)}):t('{y}: no observed annual comparison',{y:year})}</span></summary>
    {failed?<button type="button" className="retry-btn" onClick={()=>setAttempt(n=>n+1)}>{t('Retry')}</button>:region&&<div className="regional-body">
      {observed?<><dl className="regional-values"><div><dt>{t('This cell')} · {year}</dt><dd>{fmtValue(layer.id,observation)}</dd></div><div><dt>{t(region.domain==='land'?'Nearby land':'Nearby ocean')}</dt><dd>{fmtValue(layer.id,average)}</dd></div></dl><p className="regional-difference">{t('Difference:')} <b>{difference(layer.id,observation-average)}</b></p></>:<p>{t('No observed annual comparison is available for {y}. Chart estimates are excluded.',{y:year})}</p>}
      <dl className="regional-trends"><dt>{t('Local Sen slope')}</dt><dd>{fmtSlope(layer.id,placeData.slope)}</dd><dt>{t('Regional Sen slope')}</dt><dd>{region.trend?fmtSlope(layer.id,region.trend.slope):t('Not enough annual observations')}</dd></dl>
      <p className="region-method">{t(region.domain==='land'?'Area-weighted mean of {n} land cells within 500 km of the sampled grid cell. An annual mean needs at least 75% of the available area and five observed cells. Regional slopes are descriptive; no significance test is applied to this aggregate.':'Area-weighted mean of {n} ocean cells within 500 km of the sampled grid cell. An annual mean needs at least 75% of the available area and five observed cells. Regional slopes are descriptive; no significance test is applied to this aggregate.',{n:region.cells})}</p>
    </div>}
  </details>;
}
