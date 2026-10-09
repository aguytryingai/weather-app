const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const UI=require('../ui.js'),Reliability=require('../reliability.js'),Experience=require('../experience.js');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
test('forecast wall times stay in city time; epoch radar times use selected zone',()=>{
 assert.equal(UI.wallTime('2026-09-30T17:15'), '5 PM');assert.equal(UI.wallTime('2026-09-30T00:05',true),'12:05 AM');
 assert.match(UI.instant(Date.parse('2026-09-30T22:10:00Z'),'America/Chicago'),/5:10/);
 assert.match(UI.instant(Date.parse('2026-09-30T22:10:00Z'),'Asia/Tokyo'),/7:10/);
 assert.equal(UI.wallTime(null),'—');assert.match(UI.instant(0,'bad-zone'),/UTC/);
});
test('summary uses actual finite hourly values, no invented minutely claim',()=>{
 assert.equal(UI.summary({hourly:[{temp:60,p:0},{temp:null,p:null},{temp:64,p:70}]}),'Next 3 hours: 60–64° · precipitation chance up to 70%.');
 assert.equal(UI.summary({hourly:[{temp:null,p:null}]}),'Hourly outlook unavailable.');
 for(const text of ['Clear','Light drizzle','Rain','Snow','Fog','Thunderstorm','—'])assert.match(UI.icon({text}),/^<svg/);
});
test('saved forecast compatibility retains old emoji conditions',()=>{
 const c={text:'Rain',icon:'🌧️'};const w={schema:1,lat:41,lon:-87,updated:1,validAt:'2026-09-30T17:00',current:{c,temp:1,feels:1,hum:1,wind:1,precip:1,uv:1},hourly:[{t:'2026-09-30T17:00',c,temp:1,p:0}],daily:[{t:'2026-09-30',c,lo:1,hi:2,p:0}]};
 assert.equal(Reliability.savedWeather(w,41,-87),true);assert.match(UI.icon(w.current.c),/svg/);
 assert.equal(Reliability.savedWeather(w,42,-87),false);
});
function radarHarness({fail=false,hold=false,baseFail=false,host='https://tilecache.rainviewer.com'}={}){
 let release,closed=0;const delayed=new Promise(r=>release=r);const events=[];let phase=false;
 const ctx={Experience,activeDialog:null,AbortController,URL,performance,setTimeout,clearTimeout,document:{hidden:false},radarToken:0,radarController:null,
  S:{radar:{playing:false,z:7,base:[],tiles:{}}},mercator:()=>({xf:32.5,yf:47.5}),
  request:async()=>({host,radar:{past:[{time:1,path:'/old'},{time:2,path:'/latest'}],nowcast:[]}}),
  bmp:async(url,signal)=>{events.push(url);if(url.includes('/old')&&hold){phase=true;await delayed;}if(signal.aborted)throw new Error('aborted');if(fail&&url.includes('/latest'))throw new Error('missing');if(baseFail&&url.includes('openstreetmap'))throw new Error('base');return{close(){closed++}};},
  radarOnScreen:()=>true,render:()=>events.push('render:'+ctx.S.radar.frames.length),record:()=>{}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function disposeRadar('),html.indexOf('function drawRadar()')),ctx);
 return {ctx,events,release,get closed(){return closed},get phase(){return phase}};
}
test('newest frame renders before history, uses six bounded workers and keeps selected instant',async()=>{
 const h=radarHarness({hold:true});const work=h.ctx.loadRadar(41,-87);
 for(let i=0;i<20&&!h.phase;i++)await new Promise(r=>setImmediate(r));
 assert.equal(h.ctx.S.radar.ready,true);assert.equal(h.ctx.S.radar.loading,true);assert.equal(h.ctx.S.radar.frames[0].time,2);
 assert.equal(h.events.filter(x=>x.includes('openstreetmap')).length,9);assert.equal(h.events.filter(x=>x.includes('/latest')).length,9);
 assert.ok(h.events.indexOf('render:1')<h.events.findIndex(x=>x.includes('/old')));
 h.release();await work;assert.equal(h.ctx.S.radar.loading,false);assert.equal(h.ctx.S.radar.frames.length,2);assert.equal(h.ctx.S.radar.frames[h.ctx.S.radar.idx].time,2);assert.equal(h.ctx.S.radar.playing,false);
});
test('location change aborts pending history and never publishes old radar',async()=>{
 const h=radarHarness({hold:true});const work=h.ctx.loadRadar(41,-87);for(let i=0;i<20&&!h.phase;i++)await new Promise(r=>setImmediate(r));
 h.ctx.resetRadar();h.release();await work;assert.equal(h.ctx.S.radar.ready,false);assert.equal(h.ctx.S.radar.frames.length,0);assert.ok(h.closed>=18);
});
test('missing latest frame has recoverable failure; basemap failure preserves radar and signals missing tiles',async()=>{
 const h=radarHarness({fail:true});await h.ctx.loadRadar(41,-87);assert.match(h.ctx.S.radar.fail,/Newest/);assert.equal(h.ctx.S.radar.loading,false);
 const b=radarHarness({baseFail:true});await b.ctx.loadRadar(41,-87);assert.equal(b.ctx.S.radar.ready,true);assert.equal(b.ctx.S.radar.failedTiles,9);
 const bad=radarHarness({host:'https://example.com'});await bad.ctx.loadRadar(41,-87);assert.match(bad.ctx.S.radar.fail,/Unexpected/);assert.equal(bad.events.filter(x=>x.startsWith('https:')).length,0);
});
test('service worker and app versions match and new helper is precached',()=>{
 const sw=fs.readFileSync(require.resolve('../sw.js'),'utf8');assert.match(sw,/'\.\/ui.js'/);assert.equal(sw.match(/VERSION = '(.*?)'/)[1],html.match(/VERSION='(.*?)'/)[1]);
});
function flowHarness({saved=null,forecastError=false,permissionDenied=false}={}){
 const elements={};const L={id:'here',name:'Chicago',lat:41,lon:-87};
 const ctx={Experience,S:{locations:[L],sel:'here',wx:null,alerts:[],radar:{},metrics:{}},AbortController,loadToken:0,loadController:null,cancelBoot:null,
  performance,Date,setTimeout:()=>1,clearTimeout:()=>{},locationKey:()=> 'wx:test',hasCoordinates:l=>Number.isFinite(l?.lat)&&Number.isFinite(l?.lon),cachedFor:()=>saved,
  mem:new Map(),cset:()=>{},resetRadar:()=>{},render:()=>{},renderAlerts:()=>{},record:()=>{},store:{set(){}},
  $:id=>elements[id]??=( {style:{},textContent:''}),fetchAlerts:async()=>{throw new Error('offline')},fetchWeather:async()=>{if(forecastError)throw new Error('offline');return saved},
  navigator:{geolocation:{getCurrentPosition:(_ok,fail)=>fail({code:1})}}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('async function loadFor('),html.indexOf('async function switchLocation(')),ctx);
 vm.runInContext(html.slice(html.indexOf('function boot('),html.indexOf('// Boot after')),ctx);
 return {ctx,L,elements};
}
test('failed refresh retains saved forecast with explicit stale/offline wording and unavailable alerts',async()=>{
 const saved={lat:41,lon:-87,updated:Date.now()-86400000};const {ctx,L}=flowHarness({saved,forecastError:true});
 await ctx.loadFor(L);assert.equal(ctx.S.wx.updated,saved.updated);assert.equal(ctx.S.wx.fromCache,true);assert.match(ctx.S.error,/showing saved forecast/);assert.equal(ctx.S.alertState,'unavailable');assert.equal(ctx.S.busy,false);
});
test('first-use location denial leaves working city recovery and no forecast requests',()=>{
 const {ctx,L}=flowHarness({permissionDenied:true});L.lat=null;L.lon=null;ctx.boot();assert.match(ctx.S.error,/Choose a city/);assert.equal(ctx.S.wx,null);assert.equal(ctx.S.busy,false);
});
test('radar gate excludes phone forecast tabs and hidden documents',()=>{
 const ctx={Experience,activeDialog:null,S:{tab:'now',wide:false,locations:[{id:'city',lat:41,lon:-87}],sel:'city',radar:{}},document:{hidden:false,querySelector:()=>({getBoundingClientRect:()=>({top:20,bottom:200,left:0,right:300})})},$:()=>({getBoundingClientRect:()=>({top:0,bottom:800,left:0,right:390}),addEventListener(){}}),setInterval:()=>{},hasCoordinates:()=>true,loadRadar:()=>ctx.loads++,loads:0};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('const radarOnScreen='),html.indexOf('/* ================= RENDER ================= */')),ctx);
 ctx.ensureRadar();assert.equal(ctx.loads,0);ctx.S.tab='radar';ctx.ensureRadar();assert.equal(ctx.loads,1);ctx.document.hidden=true;ctx.ensureRadar();assert.equal(ctx.loads,1);ctx.document.hidden=false;ctx.S.wide=true;ctx.document.querySelector=()=>({getBoundingClientRect:()=>({top:900,bottom:1200,left:0,right:300})});ctx.ensureRadar();assert.equal(ctx.loads,1);
});
test('worker install caches all helpers; activation only removes superseded Skyward caches',async()=>{
 const handlers={},deleted=[],added=[];const ctx={self:{addEventListener:(n,fn)=>handlers[n]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>({addAll:async x=>added.push(...x)}),keys:async()=>['unrelated','skyward-shell-2.4.0','skyward-tiles-2.4.0','skyward-shell-2.5.0-rc.1','skyward-shell-2.5.1-rc.1','skyward-shell-'+html.match(/VERSION='(.*?)'/)[1],'skyward-tiles-'+html.match(/VERSION='(.*?)'/)[1]],delete:async k=>deleted.push(k)}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),ctx);let work;handlers.install({waitUntil:p=>work=p});await work;assert.ok(added.includes('./ui.js'));
 handlers.activate({waitUntil:p=>work=p});await work;assert.deepEqual(deleted,['skyward-shell-2.4.0','skyward-tiles-2.4.0','skyward-shell-2.5.0-rc.1','skyward-shell-2.5.1-rc.1']);
});
test('worker serves cached shell offline and leaves weather API freshness to app',async()=>{
 const handlers={},cached={body:'shell'};const ctx={URL,location:{origin:'https://example.test'},self:{addEventListener:(n,fn)=>handlers[n]=fn},caches:{open:async()=>({match:async()=>cached})},fetch:async()=>{throw new Error('offline')}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),ctx);let work;
 handlers.fetch({request:{method:'GET',url:'https://example.test/index.html'},respondWith:p=>work=p});assert.equal(await work,cached);
 let handled=false;handlers.fetch({request:{method:'GET',url:'https://api.open-meteo.com/v1/forecast'},respondWith:()=>handled=true});assert.equal(handled,false);
});

test('city calendar dates survive device timezone and year rollover',()=>{
 const original=process.env.TZ;
 try{
  for(const zone of ['America/Los_Angeles','Asia/Tokyo','Pacific/Kiritimati']){
   process.env.TZ=zone;
   for(const date of ['2026-12-31','2027-01-01','2026-10-05']){
    const expected=new Intl.DateTimeFormat([], {weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
    assert.equal(UI.calendarDate(date),expected);
   }
  }
  assert.equal(UI.calendarDate('2026-02-30'),'—');assert.equal(UI.calendarDate(null),'—');
 }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
test('forecast drill-in navigates repeatedly and transfers focus to the exact hour or section',()=>{
 const calls=[],target={focus:o=>calls.push(['focus',o]),scrollIntoView:o=>calls.push(['scroll',o])};
 const ctx={S:{wx:{},tab:'now',wide:false},$:id=>{calls.push(['target',id]);return target;},render:()=>calls.push(['render',ctx.S.tab])};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function openForecast('),html.indexOf('function render(){')),ctx);
 for(const wide of [false,true]){ctx.S.wide=wide;for(let i=0;i<3;i++){
  ctx.openForecast('hourly','2027-01-01T00:00');assert.equal(ctx.S.tab,'hourly');assert.ok(calls.some(c=>c[0]==='target'&&c[1]==='hour-2027-01-01T00:00'));
  ctx.openForecast('daily');assert.equal(ctx.S.tab,'daily');assert.equal(calls.at(-3)[1],'daily-heading');assert.equal(calls.at(-2)[0],'focus');assert.equal(calls.at(-1)[1].behavior,'instant');
 }}
 const before=calls.length;ctx.openForecast('radar');assert.equal(calls.length,before);ctx.S.wx=null;ctx.openForecast('hourly');assert.equal(calls.length,before);
});

test('alert normalization retains bulletin identity and severity, filters expiry, and state never masks failed refresh',()=>{
 const now=Date.parse('2026-10-09T12:00:00Z');
 const bulletin=(id,severity,expires)=>({id,properties:{event:'Flood warning',severity,urgency:'Immediate',expires,areaDesc:'King County',instruction:'Avoid flooded roads',sent:'2026-10-09T11:00:00Z'}});
 const alerts=Experience.normalizeAlerts({features:[bulletin('moderate','Moderate','2026-10-09T15:00:00Z'),bulletin('expired','Extreme','2026-10-09T11:00:00Z'),bulletin('severe','Severe','2026-10-09T14:00:00Z')]},now);
 assert.deepEqual(alerts.map(a=>a.id),['severe','moderate']);assert.equal(alerts[0].area,'King County');assert.equal(alerts[0].instruction,'Avoid flooded roads');assert.equal(alerts[0].urgency,'Immediate');
 const stale=Experience.alertView(alerts,'unavailable',now-1000,now);assert.equal(stale.kind,'stale');assert.match(stale.label,/Check failed/);assert.equal(stale.active.length,2);
 assert.equal(Experience.alertView([],'loading',null,now).kind,'loading');assert.equal(Experience.alertView([],'ready',now,now).kind,'clear');
 assert.equal(Experience.alertView([],'unavailable',now,now).kind,'unavailable');assert.equal(Experience.alertView([],'ready',now-16*60000,now).kind,'stale');
 assert.equal(Experience.alertView(alerts,'unsupported',now,now).active.length,0);
 assert.equal(Experience.unsupportedCountry('JP'),true);assert.equal(Experience.unsupportedCountry('PR'),false);assert.equal(Experience.unsupportedCountry(undefined),false);
});
test('wind uses supplied hourly speed and direction; old saved forecasts remain valid without wind',()=>{
 const data={timezone:'Asia/Tokyo',current:{time:'2026-10-10T00:00',weather_code:0,is_day:0},hourly:{time:['2026-10-10T00:00'],temperature_2m:[12],precipitation_probability:[0],weather_code:[0],is_day:[0],wind_speed_10m:[8.2],wind_direction_10m:[225]},daily:{time:['2026-10-10'],weather_code:[0]}};
 const wx=Reliability.normalize(data,35,139,'Tokyo',()=>({text:'Clear',icon:'🌙'}));assert.equal(wx.hourly[0].wind,8);assert.equal(wx.hourly[0].windDirection,225);assert.equal(Experience.windDirection(225),'SW');assert.equal(Experience.windDirection(360),'N');assert.equal(Experience.windDirection(null),'—');
 delete wx.hourly[0].wind;delete wx.hourly[0].windDirection;assert.equal(Reliability.savedWeather(wx,35,139),true);
});
test('theme persistence and system change apply only to the System selection',()=>{
 const handlers={},elements={themePreference:{},meta:{}},stored=[];
 const ctx={Experience,themePreference:null,store:{get:()=> 'system',set:(...x)=>stored.push(x)},window:{matchMedia:()=>({matches:false,addEventListener:(type,fn)=>handlers[type]=fn})},document:{documentElement:{dataset:{}},querySelector:()=>elements.meta},$:id=>elements[id],S:{radar:{ready:false}},drawRadar:()=>{}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('const colorQuery='),html.indexOf("document.addEventListener('keydown'",html.indexOf('const colorQuery='))),ctx);
 assert.equal(ctx.document.documentElement.dataset.theme,'light');
 vm.runInContext('colorQuery.matches=true',ctx);handlers.change();assert.equal(ctx.document.documentElement.dataset.theme,'dark');
 elements.themePreference.onchange({target:{value:'light'}});assert.equal(stored.at(-1)[1],'light');handlers.change();assert.equal(ctx.document.documentElement.dataset.theme,'light');
 elements.themePreference.onchange({target:{value:'bad'}});assert.equal(stored.at(-1)[1],'system');assert.equal(ctx.document.documentElement.dataset.theme,'dark');
});
test('radar ticks only complete cached frames; hidden, covered, offscreen and user pause suspend',()=>{
 let tick,draws=0;const ctx={Experience,document:{hidden:false},activeDialog:null,S:{radar:{ready:true,playing:true,expectedTiles:2,frames:[{time:1},{time:2},{time:3}],tiles:{1:[{},{}],2:[{},{}],3:[{}]},idx:1}},radarOnScreen:()=>true,drawRadar:()=>draws++,setInterval:fn=>tick=fn};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('setInterval(()=>{\n  const R='),html.indexOf('/* ================= RENDER ================= */')),ctx);
 tick();assert.equal(ctx.S.radar.idx,0);assert.equal(draws,1);tick();assert.equal(ctx.S.radar.idx,1);
 ctx.document.hidden=true;tick();assert.equal(draws,2);ctx.document.hidden=false;ctx.activeDialog='alertsPanel';tick();assert.equal(draws,2);
 ctx.activeDialog=null;ctx.radarOnScreen=()=>false;tick();assert.equal(draws,2);ctx.radarOnScreen=()=>true;ctx.S.radar.playing=false;tick();assert.equal(draws,2);
 ctx.S.radar.playing=true;ctx.S.radar.tiles[2]=[];tick();assert.equal(draws,2);
});
test('scrubbing pauses and Play explicitly resumes without reloading radar',()=>{
 const els={rcv:{},rpl:{setAttribute(){}},rsl:{}};const ctx={S:{radar:{ready:true,playing:true,frames:[{time:1},{time:2}],idx:1}},$:id=>els[id],drawRadar:()=>{}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function wireRadar(){'),html.indexOf('function renderAlerts(){')),ctx);
 ctx.wireRadar();els.rsl.oninput({target:{value:'0'}});assert.equal(ctx.S.radar.playing,false);assert.equal(ctx.S.radar.idx,0);assert.equal(els.rpl.textContent,'Play');els.rpl.onclick();assert.equal(ctx.S.radar.playing,true);
});
test('alerts dialog makes background inert, returns focus, and exposes expanded state',()=>{
 const els={};const el=id=>els[id]??={hidden:true,attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){ctx.document.activeElement=this;},isConnected:true};
 const ctx={document:{activeElement:el('btnAlerts'),querySelector:()=>el('head')},$:el,ensureRadar:()=>{}};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('let dialogReturnFocus='),html.indexOf('function openSheet(')),ctx);
 ctx.showDialog('alertsPanel','alertsClose');assert.equal(el('alertsPanel').hidden,false);assert.equal(el('body').inert,true);assert.equal(el('btnAlerts').attrs['aria-expanded'],'true');assert.equal(ctx.document.activeElement,el('alertsClose'));
 ctx.hideDialog();assert.equal(el('body').inert,false);assert.equal(ctx.document.activeElement,el('btnAlerts'));assert.equal(el('btnAlerts').attrs['aria-expanded'],'false');
});
