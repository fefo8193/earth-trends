import React,{useEffect,useMemo,useState}from'react';
import{regionalMean}from'../lib/regional.js';
import{fmtValue,fmtSlope}from'../lib/format.js';
const difference=(id,v)=>`${v>0?'+':v<0?'−':''}${Math.abs(v).toFixed(id==='temp'?2:id==='precip'?0:1)} ${id==='temp'?'°C':id==='precip'?'mm':id==='stars'?'percentage points':'cm'}`;
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
    <summary><span>Nearby region <small>500 km</small></span><span className="region-preview">{failed?'Regional context unavailable':!mask?'Preparing regional context…':!region?'Not enough matched cells':Number.isFinite(average)?`${year} average: ${fmtValue(layer.id,average)}`:`${year}: no observed annual comparison`}</span></summary>
    {failed?<button type="button" className="retry-btn" onClick={()=>setAttempt(n=>n+1)}>Retry</button>:region&&<div className="regional-body">
      {observed?<><dl className="regional-values"><div><dt>This cell · {year}</dt><dd>{fmtValue(layer.id,observation)}</dd></div><div><dt>Nearby {region.domain}</dt><dd>{fmtValue(layer.id,average)}</dd></div></dl><p className="regional-difference">Difference: <b>{difference(layer.id,observation-average)}</b></p></>:<p>No observed annual comparison is available for {year}. Chart estimates are excluded.</p>}
      <dl className="regional-trends"><dt>Local Sen slope</dt><dd>{fmtSlope(layer.id,placeData.slope)}</dd><dt>Regional Sen slope</dt><dd>{region.trend?fmtSlope(layer.id,region.trend.slope):'Not enough annual observations'}</dd></dl>
      <p className="region-method">Area-weighted mean of {region.cells} {region.domain} cells within 500 km of the sampled grid cell. An annual mean needs at least 75% of the available area and five observed cells. Regional slopes are descriptive; no significance test is applied to this aggregate.</p>
    </div>}
  </details>;
}
