/* Small, local presentation helpers. Forecast strings are location-local wall times. */
const WeatherUI = (() => {
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  function wallTime(value, minute=false) {
    const m=typeof value==='string'&&value.match(/T(\d{2}):(\d{2})/);
    if(!m)return '—';
    const h=Number(m[1]);return `${h%12||12}${minute?':'+m[2]:''} ${h<12?'AM':'PM'}`;
  }
  function instant(value, timezone, date=false) {
    try{return new Intl.DateTimeFormat([], {timeZone:timezone||'UTC',hour:'numeric',minute:'2-digit',timeZoneName:'short',...(date?{month:'short',day:'numeric'}:{})}).format(new Date(value));}
    catch{return new Intl.DateTimeFormat([], {timeZone:'UTC',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));}
  }
  // API date-only values already describe the selected city's calendar day.
  // Anchor in UTC for formatting so the device timezone cannot shift that day.
  function calendarDate(value, options={weekday:'short',month:'short',day:'numeric'}) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '—';
    const date=new Date(value+'T12:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)return '—';
    return new Intl.DateTimeFormat([], {...options,timeZone:'UTC'}).format(date);
  }
  function summary(wx){
    const hours=wx.hourly.slice(0,6),temps=hours.map(h=>h.temp).filter(finite),chances=hours.map(h=>h.p).filter(finite);
    if(!temps.length&&!chances.length)return 'Hourly outlook unavailable.';
    const parts=[];
    if(temps.length)parts.push(`Next ${hours.length} hours: ${Math.min(...temps)}–${Math.max(...temps)}°`);
    if(chances.length)parts.push(`precipitation chance up to ${Math.max(...chances)}%`);
    return parts.join(' · ')+'.';
  }
  const cloud='<path d="M7 17h11a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0 0 9Z"/>';
  const sun='<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  function icon(c){
    const t=(c?.text||'').toLowerCase();let body=cloud;
    if(t.includes('thunder')||t.includes('storm'))body=cloud+'<path d="m13 13-3 6h4l-2 4"/>';
    else if(t.includes('snow')||t.includes('grains'))body=cloud+'<path d="M8 20v3m-1.5-2.3 3 1.6m0-1.6-3 1.6M17 20v3m-1.5-2.3 3 1.6m0-1.6-3 1.6"/>';
    else if(t.includes('rain')||t.includes('drizzle')||t.includes('shower'))body=cloud+'<path d="m8 20-1 2m6-2-1 2m6-2-1 2"/>';
    else if(t.includes('fog')||t.includes('rime'))body='<path d="M4 8h16M2 12h17M5 16h17M3 20h14"/>';
    else if(t==='clear'||t==='mostly clear')body=c.icon==='🌙'?'<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>':sun;
    else if(t.includes('partly'))body='<circle cx="8" cy="7" r="4"/>'+cloud;
    else if(t==='—'||!t)body='<path d="M8 9a4 4 0 1 1 6 3c-2 1-2 2-2 3m0 4v.1"/>';
    return `<svg class="weather-icon" viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  return {wallTime,instant,calendarDate,summary,icon};
})();
if(typeof module!=='undefined')module.exports=WeatherUI;
