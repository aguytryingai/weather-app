const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const UI=require('../ui.js'),Reliability=require('../reliability.js');
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
 const ctx={AbortController,URL,performance,setTimeout,clearTimeout,document:{hidden:false},radarToken:0,radarController:null,
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
 const ctx={S:{locations:[L],sel:'here',wx:null,alerts:[],radar:{},metrics:{}},AbortController,loadToken:0,loadController:null,cancelBoot:null,
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
 const ctx={S:{tab:'now',wide:false,locations:[{id:'city',lat:41,lon:-87}],sel:'city',radar:{}},document:{hidden:false,querySelector:()=>({getBoundingClientRect:()=>({top:20,bottom:200,left:0,right:300})})},$:()=>({getBoundingClientRect:()=>({top:0,bottom:800,left:0,right:390}),addEventListener(){}}),setInterval:()=>{},hasCoordinates:()=>true,loadRadar:()=>ctx.loads++,loads:0};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('const radarOnScreen='),html.indexOf('setInterval(()=>{if(!document.hidden&&S.radar.playing')),ctx);
 ctx.ensureRadar();assert.equal(ctx.loads,0);ctx.S.tab='radar';ctx.ensureRadar();assert.equal(ctx.loads,1);ctx.document.hidden=true;ctx.ensureRadar();assert.equal(ctx.loads,1);ctx.document.hidden=false;ctx.S.wide=true;ctx.document.querySelector=()=>({getBoundingClientRect:()=>({top:900,bottom:1200,left:0,right:300})});ctx.ensureRadar();assert.equal(ctx.loads,1);
});
test('worker install caches all helpers; activation only removes superseded Skyward caches',async()=>{
 const handlers={},deleted=[],added=[];const ctx={self:{addEventListener:(n,fn)=>handlers[n]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>({addAll:async x=>added.push(...x)}),keys:async()=>['unrelated','skyward-shell-2.4.0','skyward-tiles-2.4.0','skyward-shell-2.5.0-rc.1'],delete:async k=>deleted.push(k)}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),ctx);let work;handlers.install({waitUntil:p=>work=p});await work;assert.ok(added.includes('./ui.js'));
 handlers.activate({waitUntil:p=>work=p});await work;assert.deepEqual(deleted,['skyward-shell-2.4.0','skyward-tiles-2.4.0']);
});
test('worker serves cached shell offline and leaves weather API freshness to app',async()=>{
 const handlers={},cached={body:'shell'};const ctx={URL,location:{origin:'https://example.test'},self:{addEventListener:(n,fn)=>handlers[n]=fn},caches:{open:async()=>({match:async()=>cached})},fetch:async()=>{throw new Error('offline')}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),ctx);let work;
 handlers.fetch({request:{method:'GET',url:'https://example.test/index.html'},respondWith:p=>work=p});assert.equal(await work,cached);
 let handled=false;handlers.fetch({request:{method:'GET',url:'https://api.open-meteo.com/v1/forecast'},respondWith:()=>handled=true});assert.equal(handled,false);
});
