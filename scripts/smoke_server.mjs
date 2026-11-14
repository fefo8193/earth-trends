// Local-only production smoke server with deterministic failure/latency fixtures.
// Never use this helper as a public server.
import http from 'node:http';import{readFile,stat}from'node:fs/promises';import{resolve,extname,sep}from'node:path';
const root=resolve(process.argv[2]||'dist'),port=Number(process.env.SMOKE_PORT||5180),prefix=process.env.SMOKE_BASE||'/';
let state={fail:[],latency:0,kbps:0,geolocation:null,remote:'mock'},requests=[];
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.gz':'application/gzip'};
function bootstrap(){return `<script>
(()=>{const s=${JSON.stringify({geolocation:state.geolocation,remote:state.remote})},stats={firstReadyMs:null,onlineCalls:0};
if(s.geolocation==='denied')Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok,fail)=>setTimeout(()=>fail({code:1}),30)}});
if(s.geolocation==='unsupported')Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});
const original=window.fetch.bind(window);window.fetch=(url,options)=>{if(String(url).includes('nominatim.openstreetmap.org/search')){stats.onlineCalls++;update();return Promise.resolve(new Response(s.remote==='fail'?'unavailable':JSON.stringify([{name:'QA Test Location',display_name:'QA Test Location, Test region',lat:'0',lon:'0'}]),{status:s.remote==='fail'?503:200,headers:{'Content-Type':'application/json'}}));}return original(url,options);};
function update(){const p=document.getElementById('qa-report');if(p)p.textContent=JSON.stringify(stats,null,2);}
document.addEventListener('DOMContentLoaded',()=>{const d=document.createElement('div');d.style='position:fixed;bottom:0;right:0;z-index:100000;background:#061422;color:#d8eaff;font:10px monospace;padding:4px';d.innerHTML='<button id="qa-toggle" style="color:white;background:transparent;border:0">QA report</button><pre id="qa-report" hidden></pre>';document.body.appendChild(d);document.getElementById('qa-toggle').onclick=()=>{const p=document.getElementById('qa-report');p.hidden=!p.hidden;update();};new MutationObserver(()=>{if(stats.firstReadyMs===null&&document.querySelector('.legend-layers')&&!document.querySelector('.loading')){stats.firstReadyMs=Math.round(performance.now());update();}}).observe(document.getElementById('root'),{childList:true,subtree:true});});})();
</script>`;}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/__qa/log'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state,requests},null,2));return;}
 if(url.pathname==='/__qa/control'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const next=JSON.parse(body||'{}');if(next.reset)requests=[];delete next.reset;state={...state,...next};res.end('ok');return;}
 if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end('not found');return;}
 let path=url.pathname.slice(prefix.length-1);if(path==='/'||path.endsWith('/index.html'))path='/index.html';
 const record={path,status:200,bytes:0,started:Date.now()};requests.push(record);
 try{
  if(state.latency)await new Promise(r=>setTimeout(r,state.latency));
  if(state.fail.includes(path)){record.status=503;res.writeHead(503);res.end('fixture: unavailable');return;}
  const file=resolve(root,'.'+path);if(file!==root&&!file.startsWith(root+sep))throw new Error('outside root');
  if(!(await stat(file)).isFile())throw new Error('not file');let bytes=await readFile(file);
  if(extname(file)==='.html')bytes=Buffer.from(bytes.toString().replace('</head>',bootstrap()+'</head>'));
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Content-Length',bytes.length);record.bytes=bytes.length;
  if(state.kbps&&(/\.(gz|jpg|png|json)$/.test(file))){const chunk=16384,delay=chunk/(state.kbps*1024)*1000;for(let i=0;i<bytes.length;i+=chunk){if(res.destroyed)break;res.write(bytes.subarray(i,i+chunk));await new Promise(r=>setTimeout(r,delay));}res.end();}else res.end(bytes);
 }catch{record.status=404;res.writeHead(404);res.end('not found');}
 finally{record.durationMs=Date.now()-record.started;}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local smoke server: http://127.0.0.1:${port}${prefix} → ${root}`));
