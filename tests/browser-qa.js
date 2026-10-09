/* Isolated rendering/interaction QA. Uses system Playwright and a separately installed browser.
   Run: PLAYWRIGHT_BROWSERS_PATH=/tmp/skyward-playwright node tests/browser-qa.js
   Network weather/map responses are deterministic fixtures, not live observations. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.SKYWARD_QA_OUTPUT||path.join(root,'../skyward-redesign-qa'));
fs.mkdirSync(out,{recursive:true});
const fixed=Date.parse('2026-10-09T21:20:00Z');
function png(radar=false){
 const w=256,raw=Buffer.alloc((w*4+1)*w);for(let y=0;y<w;y++)for(let x=0;x<w;x++){
  const i=y*(w*4+1)+1+x*4,inside=(x-150)**2+(y-120)**2<6000;
  const c=radar?(inside?[0,163,224,185]:[0,0,0,0]):((x%60<3||y%70<3)?[90,90,90,255]:[223,228,223,255]);c.forEach((v,k)=>raw[i+k]=v);
 }
 const crc=b=>{let c=-1;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^-1)>>>0};
 const chunk=(type,data)=>{const b=Buffer.concat([Buffer.from(type),data]),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(b));return Buffer.concat([n,b,c])};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w);ih.writeUInt32BE(w,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const basePNG=png(),rainPNG=png(true);
function weather(tokyo=false){
 const day=tokyo?'2026-10-10':'2026-10-09',start=tokyo?6:16;
 const times=Array.from({length:24},(_,i)=>new Date(Date.parse(day+'T00:00:00Z')+(start+i)*3600000).toISOString().slice(0,16));
 return{timezone:tokyo?'Asia/Tokyo':'America/Chicago',current:{time:times[0],temperature_2m:58,apparent_temperature:56,relative_humidity_2m:86,wind_speed_10m:8,wind_direction_10m:225,precipitation:0.2,uv_index:1,is_day:1,weather_code:61},hourly:{time:times,temperature_2m:times.map((_,i)=>58-Math.floor(i/3)),precipitation_probability:times.map((_,i)=>Math.max(5,80-i*10)),weather_code:times.map((_,i)=>i<3?61:i<6?3:0),is_day:times.map((_,i)=>i<2?1:0),wind_speed_10m:times.map((_,i)=>Math.max(2,8-i)),wind_direction_10m:times.map(()=>225)},daily:{time:Array.from({length:10},(_,i)=>new Date(Date.parse(day+'T00:00:00Z')+i*86400000).toISOString().slice(0,10)),temperature_2m_max:Array(10).fill(61),temperature_2m_min:Array(10).fill(49),precipitation_probability_max:Array(10).fill(40),weather_code:Array(10).fill(61),sunrise:Array(10).fill(day+'T07:20'),sunset:Array(10).fill(day+'T18:31')}};
}
const alerts={features:[{id:'qa-flood-1',properties:{event:'Flood Warning',severity:'Severe',urgency:'Immediate',headline:'Illustrative QA flood warning — not a real alert',description:'Synthetic warning used to verify the panel. No live warning is being reported.',instruction:'Sample instruction: avoid flooded roads.',areaDesc:'Chicago test area',sent:'2026-10-09T20:55:00Z',expires:'2026-10-10T02:00:00Z',senderName:'National Weather Service (QA fixture)'}}]};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{const p=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/weather-app\//,'');const f=path.resolve(root,p||'index.html');if(!f.startsWith(root+path.sep)){res.writeHead(404).end();return;}fs.readFile(f,(e,b)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',mime[path.extname(f)]||'text/plain');res.end(b)});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/weather-app/`;
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 const results=[],errors=[];let currentContext;
 async function setup(width=390,theme='dark',reducedMotion='no-preference',seed=true){
  const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,colorScheme:theme,reducedMotion,serviceWorkers:'block'});currentContext=context;
  const state={alertFail:false,weatherFail:false,tiles:0,base:0,metadata:0,alertEmpty:false};
  await context.addInitScript(({fixed,seed})=>{Date.now=()=>fixed;if(seed&&!localStorage.getItem('sky:locs')){localStorage.setItem('sky:locs',JSON.stringify([{id:'here',isGPS:true,name:'My Location',lat:null,lon:null},{id:'qa-chicago',name:'Chicago',lat:41.8781,lon:-87.6298,countryCode:'US'}]));localStorage.setItem('sky:selected','"qa-chicago"');}},{fixed,seed});
  await context.route('https://**/*',async route=>{
   const u=new URL(route.request().url());const json=o=>route.fulfill({contentType:'application/json',body:JSON.stringify(o)});
   if(u.hostname==='api.open-meteo.com'){if(state.weatherFail)return route.abort();return json(weather(Number(u.searchParams.get('longitude'))>0));}
   if(u.hostname==='geocoding-api.open-meteo.com')return json({results:[{name:'Tokyo',admin1:'Tokyo',country:'Japan',country_code:'JP',latitude:35.68,longitude:139.76}]});
   if(u.hostname==='api.weather.gov'){if(state.alertFail)return route.fulfill({status:503,body:'unavailable'});return json(state.alertEmpty?{features:[]}:alerts);}
   if(u.hostname==='api.rainviewer.com'){state.metadata++;return json({host:'https://tilecache.rainviewer.com',radar:{past:Array.from({length:7},(_,i)=>({time:Math.floor(fixed/1000)-3600+i*600,path:'/v2/radar/'+(Math.floor(fixed/1000)-3600+i*600)}))}});}
   if(u.hostname==='tilecache.rainviewer.com'){state.tiles++;return route.fulfill({contentType:'image/png',body:rainPNG});}
   if(u.hostname==='tile.openstreetmap.org'){state.base++;return route.fulfill({contentType:'image/png',body:basePNG});}
   return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);if(seed)await page.locator('.hero .big').waitFor();return{page,context,state};
 }
 const shot=async(p,name)=>{await p.screenshot({path:path.join(out,name+'.png')});};
 try{
 for(const width of [390,554,1280])for(const theme of ['dark','light']){
  const {page:p,context:c,state}=await setup(width,theme);
  assert.equal(await p.locator('.day').count(),10);assert.equal(await p.locator('.hcell').count(),width<600?6:0);
  assert.equal(await p.locator('[data-forecast] .forecast-hint').count(),0);
  assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await shot(p,`${width}-${theme}-forecast`);
  if(width<600){assert.equal(state.metadata,0);await p.getByRole('button',{name:'Hourly',exact:true}).click();}
  await p.locator('#hourly-heading').waitFor();assert.equal(await p.locator('.hour-row').count(),24);assert.equal(await p.locator('.hour-wind').count(),24);assert.ok(await p.locator('.timeline-day').count()>=2);
  const over=await p.locator('.hour-row').evaluateAll(rows=>rows.some(r=>r.scrollWidth>r.clientWidth+1));assert.equal(over,false,'hourly row overflow');
  await shot(p,`${width}-${theme}-hourly`);
  await p.locator('#btnAlerts').click();await p.locator('#alertsPanel').waitFor({state:'visible'});assert.match(await p.locator('#alertsContent').innerText(),/Severe/i);
  await p.keyboard.press('Shift+Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'alertsRetry');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'alertsClose');
  await shot(p,`${width}-${theme}-alerts`);await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'btnAlerts');
  if(width<600){await p.getByRole('button',{name:'Forecast',exact:true}).click();await p.locator('.hcell').nth(3).click();assert.equal(await p.evaluate(()=>document.activeElement.id),'hour-2026-10-09T19:00');await p.getByRole('button',{name:'Forecast',exact:true}).click();await p.locator('.detail-link').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'daily-heading');assert.equal(await p.locator('.day').count(),10);}
  await p.locator('#btnDiagnostics').click();await p.locator('#themePreference').selectOption(theme==='dark'?'light':'dark');await p.keyboard.press('Escape');await p.reload();await p.locator('.hero .big').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme==='dark'?'light':'dark');
  await p.locator('#btnDiagnostics').click();await p.locator('#themePreference').selectOption('system');await p.keyboard.press('Escape');await p.emulateMedia({colorScheme:theme==='dark'?'light':'dark'});await p.waitForFunction(t=>document.documentElement.dataset.theme===t,theme==='dark'?'light':'dark');assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme==='dark'?'light':'dark');
  results.push({width,theme,result:'pass'});await c.close();
 }
 const {page:p,context:c,state}=await setup();
 await p.locator('#tab-radar').click();await p.locator('#rcv').waitFor();await p.waitForFunction(()=>S.radar.frames.length===7&&!S.radar.loading);
 const initial=await p.evaluate(()=>S.radar.idx);await p.waitForFunction(i=>S.radar.idx!==i,initial);assert.equal(await p.locator('#rpl').innerText(),'Pause');assert.equal(state.tiles,63);assert.equal(state.base,9);
 await shot(p,'390-dark-radar');await p.locator('#rpl').click();const paused=await p.evaluate(()=>S.radar.idx);await p.waitForTimeout(800);assert.equal(await p.evaluate(()=>S.radar.idx),paused);
 await p.locator('#rsl').press('Home');assert.equal(await p.locator('#rpl').innerText(),'Play');await p.locator('#rpl').click();await p.locator('#btnAlerts').click();const covered=await p.evaluate(()=>S.radar.idx);await p.waitForTimeout(800);assert.equal(await p.evaluate(()=>S.radar.idx),covered);await p.keyboard.press('Escape');
 await p.locator('#tab-now').click();const offscreen=await p.evaluate(()=>S.radar.idx);await p.waitForTimeout(800);assert.equal(await p.evaluate(()=>S.radar.idx),offscreen);assert.equal(state.tiles,63);
 state.alertFail=true;await p.locator('#btnRefresh').click();await p.waitForFunction(()=>S.alertState==='unavailable');await p.locator('#btnAlerts').click();assert.match(await p.locator('#alertsContent').innerText(),/Could not update/);assert.match(await p.locator('#alertsContent').innerText(),/Flood Warning/);await shot(p,'390-dark-stale-alerts');await p.keyboard.press('Escape');
 state.weatherFail=true;await p.locator('#btnRefresh').click();await p.waitForFunction(()=>S.error.includes('showing saved'));assert.match(await p.locator('#offlineBar').innerText(),/saved forecast/);state.weatherFail=false;state.alertFail=false;state.alertEmpty=true;await p.locator('#btnRefresh').click();await p.waitForFunction(()=>S.alertState==='ready'&&S.alerts.length===0);await p.locator('#btnAlerts').click();assert.match(await p.locator('#alertsContent').innerText(),/No active alerts reported/);await p.keyboard.press('Escape');state.alertEmpty=false;
 await p.locator('#btnSearch').click();await p.locator('#searchInput').fill('Tokyo');await p.locator('.sugg .it').waitFor();await p.locator('.sugg .it').click();await p.waitForFunction(()=>S.wx?.timezone==='Asia/Tokyo');assert.equal(await p.evaluate(()=>S.alertState),'unsupported');await p.locator('#tab-hourly').click();assert.match(await p.locator('.timeline-day').first().innerText(),/Oct 10/i);assert.match(await p.locator('.hour-row').first().innerText(),/6 AM/);await shot(p,'390-dark-tokyo');await p.reload();await p.waitForFunction(()=>S.wx?.timezone==='Asia/Tokyo');assert.ok(await p.evaluate(()=>S.locations.some(l=>l.name==='Tokyo')));await c.close();
 const reduced=await setup(390,'light','reduce');await reduced.page.locator('#tab-radar').click();await reduced.page.waitForFunction(()=>S.radar.frames.length===7);assert.equal(await reduced.page.locator('#rpl').innerText(),'Play');await reduced.page.locator('#rpl').click();assert.equal(await reduced.page.locator('#rpl').innerText(),'Pause');await reduced.page.emulateMedia({reducedMotion:'no-preference'});await reduced.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await reduced.page.emulateMedia({reducedMotion:'reduce'});await reduced.page.waitForFunction(()=>document.querySelector('#rpl').textContent==='Play');assert.equal(await reduced.page.locator('#rpl').innerText(),'Play');await shot(reduced.page,'390-light-radar-reduced-motion');await reduced.context.close();
 const denied=await setup(390,'light','no-preference',false);await denied.page.getByRole('button',{name:'Choose location',exact:true}).waitFor();assert.match(await denied.page.locator('#body').innerText(),/Location unavailable|Choose a location/);assert.equal(denied.state.tiles,0);await denied.context.close();
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({browser:browser.version(),fixture:true,results,extra:'radar autoplay/pause/scrub/offscreen/dialog/reduced-motion, stale alerts, saved forecast, Tokyo, location denied',errors},null,2));console.log('PASS',results.length,'layout/theme scenarios and functional scenarios');
 }finally{await currentContext?.close().catch(()=>{});await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
