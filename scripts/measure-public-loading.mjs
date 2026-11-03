// Cold-start comparison of two public builds; no production data is modified.
// Times include Playwright polling and are diagnostic lab observations, not field INP or Lighthouse TBT.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {gzipSync} from 'node:zlib';
const [baseline, candidate, output = '.superpowers/loading-comparison.json'] = process.argv.slice(2);
if (!baseline || !candidate) throw new Error('Usage: node scripts/measure-public-loading.mjs BASELINE_DIR CANDIDATE_DIR [OUTPUT_JSON]');
const roots={before:resolve(baseline),after:resolve(candidate)};
const servers=[],urls={};
for(const [label,root] of Object.entries(roots)){
 const cache=new Map();
 const server=createServer(async(req,res)=>{try {
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  let entry=cache.get(file);if(!entry){const data=await readFile(file),ext=extname(file);const compressed=/\.(html|js|css|json|geojson|svg)$/.test(file);entry={body:compressed?gzipSync(data):data,headers:{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/geo+json','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'}[ext]||'application/octet-stream','cache-control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache',...(compressed?{'content-encoding':'gzip'}:{})}};cache.set(file,entry);}
  res.writeHead(200,{...entry.headers,'content-length':entry.body.length}).end(entry.body);
 }catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server);urls[label]=`http://127.0.0.1:${server.address().port}`;
}
const browser=await chromium.launch(),results=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
try{
 for(let run=0;run<Number(process.env.PERF_RUNS || 5);run++)for(const label of (run%2?['after','before']:['before','after'])){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,serviceWorkers:'block'});const page=await context.newPage();const cdp=await context.newCDPSession(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8,connectionType:'cellular4g'});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===urls[label])return route.continue();const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});if(u.pathname.endsWith('/createSession'))return route.fulfill({headers,json:{session:'performance-fixture',expiry:String(Math.floor(Date.now()/1000)+86400)}});if(u.pathname.includes('/viewport'))return route.fulfill({headers,json:{copyright:'Performance fixture'}});if(u.pathname.includes('/survey-progress'))return route.fulfill({headers,json:{stages:{},pending:{}}});return route.fulfill({headers,contentType:'image/png',body:png});});
  await page.addInitScript(()=>{window.audit={lcp:0,candidates:[],shifts:[],long:[]};new PerformanceObserver(l=>{window.audit.lcp=l.getEntries().at(-1).startTime;window.audit.candidates.push(...l.getEntries().map(e=>({at:e.startTime,size:e.size,tag:e.element?.tagName,className:e.element?.className})))}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>window.audit.shifts.push(...l.getEntries().filter(e=>!e.hadRecentInput).map(e=>e.value))).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>window.audit.long.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});
  await page.goto(urls[label],{waitUntil:'domcontentloaded'});await page.locator('.atlas-total__num').waitFor();await page.locator('#map canvas').first().waitFor();
  const ready=await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(performance.now())))));
  await page.waitForTimeout(1000);
  const startup=await page.evaluate(()=>({...window.audit,canvas:[...document.querySelectorAll('#map canvas')].map(c=>({width:c.width,height:c.height})),overflow:document.documentElement.scrollWidth>innerWidth,domNodes:document.querySelectorAll('*').length,resources:performance.getEntriesByType('resource').filter(e=>new URL(e.name).origin===location.origin).map(e=>({path:new URL(e.name).pathname,start:e.startTime,end:e.responseEnd,encodedBytes:e.encodedBodySize,transferBytes:e.transferSize})),fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime}));
  const searchStart=await page.evaluate(()=>performance.now());await page.getByRole('searchbox').fill('JAMBI');await page.locator('.atlas-pt').first().waitFor({state:'attached'});
  const searchEnd=await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(performance.now())))));
  const rows=await page.locator('.atlas-pt').count();await page.locator('.atlas-pt').first().click();await page.locator('#popup').waitFor();

  results.push({label,run,readyMs:Math.round(ready),fcpMs:startup.fcp,lcpMs:startup.lcp,lcpCandidates:startup.candidates,domNodes:startup.domNodes,resources:startup.resources,cls:startup.shifts.reduce((a,b)=>a+b,0),startupBlockingMs:startup.long.filter(e=>e.start<ready).reduce((s,e)=>s+Math.max(0,e.duration-50),0),searchMs:Math.round(searchEnd-searchStart),rows,canvas:startup.canvas,overflow:startup.overflow,errors});
  const {resources,lcpCandidates,...summary}=results.at(-1);console.log(JSON.stringify(summary));await context.close();
 }
}finally{await browser.close();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));}
await writeFile(output,JSON.stringify({profile:{viewport:{width:390,height:844},deviceScaleFactor:3,cpuSlowdown:6,latencyMs:150,downloadBitsPerSecond:1600000,uploadBitsPerSecond:750000,compression:'gzip',freshContextEachRun:true,serviceWorkers:'blocked',thirdPartyRequests:'fixtures',httpCache:'enabled, immutable assets'},runs:results},null,2)+'\n');
