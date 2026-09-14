/* Shared browser/Node helpers. No runtime dependencies. */
const Reliability = (() => {
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const rounded = value => number(value) === null ? null : Math.round(value);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const display = (value, unit = '') => number(value) === null ? '—' : value + unit;
  const abortError = () => Object.assign(new Error('Request cancelled'), {name:'AbortError'});
  const logs = [];
  function record(context, error) {
    // Do not retain request URLs or coordinates in the diagnostic log.
    logs.push({time:new Date().toISOString(), context, message:String(error.message || error).slice(0,200)});
    if (logs.length > 40) logs.shift();
  }
  async function request(url, {signal, timeout = 8000, retries = 1, ...options} = {}, decode = r => r.json()) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, {once:true});
      const timer = setTimeout(cancel, timeout);
      try {
        const response = await fetch(url, {cache:'no-store', ...options, signal:controller.signal});
        if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), {status:response.status});
        const value = await decode(response);
        if (signal?.aborted) throw abortError();
        return value;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        const failure = controller.signal.aborted ? new Error('Request timed out') : error;
        const transient = !error.status && !(error instanceof SyntaxError) || error.status >= 500;
        if (attempt >= retries || !transient) throw failure;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    }
  }
  function normalize(d, lat, lon, location, cond, now = Date.now()) {
    if (!d?.current || typeof d.current.time !== 'string' || !d.hourly || !d.daily ||
        !Array.isArray(d.hourly.time) || !Array.isArray(d.daily.time) || !d.daily.time.length ||
        d.hourly.time.some(t => typeof t !== 'string') || d.daily.time.some(t => typeof t !== 'string')) {
      throw new Error('Weather response is incomplete');
    }
    // Select the containing hour, including exact-hour boundaries. Never wrap to yesterday.
    const next = d.hourly.time.findIndex(t => t > d.current.time);
    const start = next < 0 ? Math.max(0, d.hourly.time.length - 1) : Math.max(0, next - 1);
    const get = (group, field, i) => Array.isArray(group[field]) ? group[field][i] : null;
    const current = d.current;
    return {schema:1, lat, lon, location, updated:now, validAt:current.time, timezone:d.timezone || '', fromCache:false,
      current:{temp:rounded(current.temperature_2m), feels:rounded(current.apparent_temperature),
        hum:number(current.relative_humidity_2m), wind:rounded(current.wind_speed_10m),
        precip:number(current.precipitation), uv:number(current.uv_index), c:cond(current.weather_code,current.is_day)},
      hourly:d.hourly.time.slice(start,start+24).map((t,i) => {const j=start+i;return {
        t,temp:rounded(get(d.hourly,'temperature_2m',j)),p:number(get(d.hourly,'precipitation_probability',j)),
        c:cond(get(d.hourly,'weather_code',j),get(d.hourly,'is_day',j))};}),
      daily:d.daily.time.map((t,i) => ({t,hi:rounded(get(d.daily,'temperature_2m_max',i)),
        lo:rounded(get(d.daily,'temperature_2m_min',i)),p:number(get(d.daily,'precipitation_probability_max',i)),
        c:cond(get(d.daily,'weather_code',i),1)})),
      sunrise:get(d.daily,'sunrise',0),sunset:get(d.daily,'sunset',0)};
  }
  function savedWeather(value, lat, lon) {
    const fields = (o, keys) => keys.every(k => o[k] === null || number(o[k]) !== null);
    const condition = c => c && typeof c.text === 'string' && typeof c.icon === 'string';
    return value?.schema === 1 && number(value.updated) !== null && value.updated > 0 &&
      number(value.lat) !== null && number(value.lon) !== null &&
      Math.abs(value.lat-lat) < .001 && Math.abs(value.lon-lon) < .001 &&
      typeof value.validAt === 'string' && condition(value.current?.c) &&
      fields(value.current,['temp','feels','hum','wind','precip','uv']) &&
      Array.isArray(value.hourly) && value.hourly.every(h => h && typeof h.t === 'string' && condition(h.c) && fields(h,['temp','p'])) &&
      Array.isArray(value.daily) && value.daily.length > 0 && value.daily.every(d => d && typeof d.t === 'string' && condition(d.c) && fields(d,['lo','hi','p']));
  }
  return {number, rounded, escape, display, request, normalize, savedWeather, record, logs};
})();
if (typeof module !== 'undefined') module.exports = Reliability;
