/* Small pure helpers shared by the app and its regression tests. */
const Experience = (() => {
  const themes=['system','light','dark'];
  const preference=value=>themes.includes(value)?value:'system';
  const theme=(value,systemDark)=>preference(value)==='system'?(systemDark?'dark':'light'):value;
  const windDirection=value=>typeof value==='number'&&Number.isFinite(value)?['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((value%360+360)%360)/22.5)%16]:'—';
  const supportedCountries=new Set(['US','PR','VI','GU','AS','MP','UM']);
  const unsupportedCountry=code=>typeof code==='string'&&code.length===2&&!supportedCountries.has(code.toUpperCase());
  function normalizeAlerts(data,now=Date.now()){
    if(!Array.isArray(data?.features))throw new Error('Alert response is incomplete');
    const rank={Extreme:0,Severe:1,Moderate:2,Minor:3,Unknown:4};
    return data.features.filter(f=>f?.properties).map(f=>{
      const p=f.properties;
      return {id:String(p.id||f.id||''),event:String(p.event||'Weather alert'),head:String(p.headline||''),
        severity:rank[p.severity]===undefined?'Unknown':p.severity,urgency:String(p.urgency||'Unknown'),
        description:String(p.description||''),instruction:String(p.instruction||''),area:String(p.areaDesc||''),
        sent:p.sent||null,effective:p.effective||null,expires:p.expires||null,sender:String(p.senderName||'National Weather Service')};
    }).filter(a=>!Number.isFinite(Date.parse(a.expires))||Date.parse(a.expires)>now)
      .sort((a,b)=>rank[a.severity]-rank[b.severity]);
  }
  function alertView(alerts,state,checked,now=Date.now()){
    const active=alerts.filter(a=>!Number.isFinite(Date.parse(a.expires))||Date.parse(a.expires)>now);
    const stale=!!checked&&now-checked>15*60000;
    if(state==='unsupported')return {kind:'unsupported',label:'Alerts not supported here',active:[]};
    if(active.length){
      const suffix=state==='unavailable'?' · Check failed':state==='loading'?' · Updating':stale?' · Check overdue':'';
      return {kind:state==='unavailable'||stale?'stale':'active',label:active.length===1?active[0].event+suffix:active.length+' weather alerts'+suffix,active};
    }
    if(state==='unavailable')return {kind:'unavailable',label:'Alerts unavailable',active};
    if(state==='loading'||state==='idle')return {kind:'loading',label:state==='idle'?'Choose a location to check alerts':'Checking alerts…',active};
    if(stale)return {kind:'stale',label:'Alert check overdue',active};
    return {kind:'clear',label:'No active alerts reported',active};
  }
  function canAnimate({playing,frames,hidden,visible,dialog}){
    return !!playing&&frames>=2&&!hidden&&visible&&!dialog;
  }
  return {themes,preference,theme,windDirection,unsupportedCountry,normalizeAlerts,alertView,canAnimate};
})();
if(typeof module!=='undefined')module.exports=Experience;
