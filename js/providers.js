// Place search + travel time for India, using only free services:
// Photon (search), Nominatim (reverse geocode), OSRM/FOSSGIS (road + walking), Transitous (bus timetables),
// and the bundled metro network (js/metro.js).
import { MIN, fmtTime } from './plan.js';
import * as M from './metro.js';
import { travelFactor } from './store.js';

export const MODES = {
  metro: { label: 'Metro', icon: 'metro' },
  cab: { label: 'Cab', icon: 'car' },
  auto: { label: 'Auto', icon: 'auto' },
  bike: { label: 'Bike', icon: 'scooter' },
  bus: { label: 'Bus', icon: 'bus' },
  walk: { label: 'Walk', icon: 'walk' },
};
export const MODE_KEYS = Object.keys(MODES);
export const MILE_MODES = ['walk', 'auto', 'cab', 'bike'];

const INDIA_BBOX = '68.1,6.5,97.4,35.7';

async function getJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}

// ---------- Places ----------

export async function searchPlaces(q, near, signal) {
  const p = new URLSearchParams({ q, limit: '8', lang: 'en', bbox: INDIA_BBOX });
  if (near) { p.set('lat', near.lat); p.set('lon', near.lng); p.set('location_bias_scale', '0.4'); }
  const j = await getJSON(`https://photon.komoot.io/api/?${p}`, { signal });
  const seen = new Set();
  // Photon's ranking is loose; prefer results whose name contains the words typed.
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const score = (f) => {
    const name = (f.properties.name || '').toLowerCase().replace(/\s+/g, ' ');
    const rest = [f.properties.city, f.properties.district, f.properties.state].join(' ').toLowerCase();
    const single = words.reduce((a, w) => a + (name.includes(w) || name.replace(/ /g, '').includes(w) ? 1 : rest.includes(w) ? 0.4 : 0), 0);
    const phrases = words.slice(1).reduce((a, w, i) => a + (name.includes(`${words[i]} ${w}`) ? 1 : 0), 0);
    return single + phrases;
  };
  return j.features
    .filter((f) => !f.properties.countrycode || f.properties.countrycode === 'IN')
    .map((f, i) => ({ f, i, s: score(f) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ f }) => f)
    .map((f) => {
      const pr = f.properties;
      const street = [pr.housenumber, pr.street].filter(Boolean).join(' ');
      const name = pr.name || street || pr.city || 'Unnamed place';
      const parts = [street !== name ? street : '', pr.district || pr.locality, pr.city !== name ? pr.city : '', pr.state];
      const address = [...new Set(parts.filter(Boolean))].join(', ');
      return { id: `${pr.osm_type}${pr.osm_id}`, name, address, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    })
    .filter((p) => !seen.has(p.name + p.address) && seen.add(p.name + p.address))
    .slice(0, 6);
}

export async function reverseGeocode(lat, lng) {
  try {
    const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=17`);
    const a = j.address || {};
    return { address: [a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean).join(', ') || j.display_name };
  } catch {
    return { address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
  }
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied' : 'Could not get your location')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

// ---------- Single legs ----------

const osrmCache = new Map();
function osrm(profile, a, b) {
  const key = `${profile}|${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
  if (!osrmCache.has(key)) {
    const p = getJSON(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`)
      .then((j) => {
        if (j.code !== 'Ok' || !j.routes?.length) throw new Error('No route found');
        return { secs: j.routes[0].duration, km: j.routes[0].distance / 1000 };
      });
    p.catch(() => osrmCache.delete(key));
    osrmCache.set(key, p);
  }
  return osrmCache.get(key);
}

// Typical Indian city traffic for the hour you'd be on the road (OSRM has no live traffic).
export function trafficFactor(atMs) {
  const d = new Date(atMs), h = d.getHours(), weekend = d.getDay() === 0 || d.getDay() === 6;
  if (h >= 23 || h < 6) return 1.05;
  if (!weekend && ((h >= 8 && h < 11) || (h >= 17 && h < 21))) return 1.65;
  return weekend ? 1.3 : 1.4;
}

// Extra minutes on top of riding: waiting for a cab/auto to arrive, parking a bike.
const WAIT = { cab: 6, auto: 4, bike: 2, walk: 0 };

export async function legTime(mode, a, b, atMs) {
  const straight = M.km(a, b);
  if (mode === 'walk') {
    if (straight < 0.08) return { mins: 1, km: straight };
    try { const r = await osrm('foot', a, b); return { mins: Math.max(1, Math.ceil(r.secs / 60)), km: r.km }; }
    catch { return { mins: Math.max(1, Math.ceil((straight * 1.3 / 4.5) * 60)), km: straight * 1.3, approx: true }; }
  }
  let secs, dist, approx = false;
  try { const r = await osrm('car', a, b); secs = r.secs; dist = r.km; }
  catch { dist = straight * 1.4; secs = (dist / 25) * 3600; approx = true; }
  const f = trafficFactor(atMs);
  const traffic = mode === 'bike' ? 1 + (f - 1) * 0.55 : mode === 'auto' ? f * 1.05 : f;
  return { mins: Math.ceil((secs * traffic) / 60) + WAIT[mode], km: dist, approx, traffic: f > 1.2 };
}

// ---------- Journeys ----------

const cache = new Map();
const CACHE_MS = 8 * MIN;

// Returns { mins, legs:[{mode, mins, title, detail, segments?}], source, live, note?, metro?, departAt?, arriveAt? }
export function getTravel({ from, to, mode, arriveBy, metro, fresh = false }) {
  const key = JSON.stringify([mode, from.lat.toFixed(4), from.lng.toFixed(4), to.lat.toFixed(4), to.lng.toFixed(4), Math.round(arriveBy / (5 * MIN)), mode === 'metro' ? metro || null : null]);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = journey({ from, to, mode, arriveBy, metro, fresh }).then((r) => ({ ...r, fetchedAt: Date.now() }));
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

const fmtKm = (k) => (k < 1 ? `${Math.round(k * 1000)} m` : `${k.toFixed(1)} km`);

// ---------- Traffic (TomTom through the backend: predicted for future trips, live for soon) ----------

let trafficReadyP;
export function trafficReady() {
  trafficReadyP ||= fetch('api/traffic', { cache: 'no-store' })
    .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : {}))
    .then((j) => !!j.ready).catch(() => false);
  return trafficReadyP;
}

// One request serves cab, auto and bike (they share the car route), cached per 5-minute arrival slot.
const trafficCache = new Map();
function carTraffic(a, b, arriveBy, fresh) {
  const key = [a.lat.toFixed(4), a.lng.toFixed(4), b.lat.toFixed(4), b.lng.toFixed(4), Math.round(arriveBy / (5 * MIN))].join('|');
  if (fresh || !trafficCache.has(key)) {
    const p = fetch('api/traffic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: { lat: a.lat, lng: a.lng }, to: { lat: b.lat, lng: b.lng }, arriveBy }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('traffic ' + r.status))));
    p.catch(() => trafficCache.delete(key));
    trafficCache.set(key, p);
  }
  return trafficCache.get(key);
}

const clock = fmtTime;
const day = (ms) => new Date(ms).toLocaleDateString('en-IN', { weekday: 'short' });

async function roadJourney({ from, to, mode, arriveBy, fresh }) {
  const waitTxt = WAIT[mode] ? ` · ${WAIT[mode]} min to ${mode === 'bike' ? 'park' : 'get one'}` : '';
  let mins, km, traffic, source = 'OpenStreetMap', live = true;
  try {
    if (!(await trafficReady())) throw new Error('no traffic');
    const t = await carTraffic(from, to, arriveBy, fresh);
    // Autos run a little slower than cars; two-wheelers filter through about half of the congestion.
    const congestion = Math.max(0, t.mins - (t.freeMins ?? t.mins));
    const ride = mode === 'auto' ? t.mins * 1.05 : mode === 'bike' ? t.mins - congestion * 0.45 : t.mins;
    mins = Math.ceil(ride) + WAIT[mode];
    km = t.km;
    traffic = t.kind === 'live' ? 'live traffic' : `traffic predicted for ${day(t.departAt)} ${clock(t.departAt)}`;
    source = t.kind === 'live' ? 'TomTom live traffic' : 'TomTom predicted traffic';
  } catch {
    const r = await legTime(mode, from, to, arriveBy - 40 * MIN);
    mins = r.mins; km = r.km; live = !r.approx;
    traffic = r.traffic ? 'usual traffic for that hour' : 'light traffic expected';
  }
  // Personal correction from this person's own past trips on this route at this hour.
  const f = travelFactor(routeKey(mode, from, to, arriveBy));
  if (f) { mins = Math.max(1, Math.round(mins * f.factor)); traffic += ` · adjusted to your ${f.n} past trip${f.n > 1 ? 's' : ''}`; }
  return { mins, distanceKm: km, source, live, traffic, legs: [{ mode, mins, title: `${MODES[mode].label} to ${to.name}`, detail: `${fmtKm(km)} · ${traffic}${waitTxt}` }] };
}

// Same route, mode and hour of day → one learning bucket.
export const routeKey = (mode, a, b, atMs) => [mode, a.lat.toFixed(2), a.lng.toFixed(2), b.lat.toFixed(2), b.lng.toFixed(2), new Date(atMs).getHours()].join('|');

async function journey({ from, to, mode, arriveBy, metro, fresh }) {
  if (mode === 'metro') return metroJourney({ from, to, arriveBy, metro });
  if (mode === 'bus') return busJourney({ from, to, arriveBy });
  if (mode !== 'walk') return roadJourney({ from, to, mode, arriveBy, fresh });
  const r = await legTime(mode, from, to, arriveBy);
  return { mins: r.mins, distanceKm: r.km, source: 'OpenStreetMap', live: !r.approx, legs: [{ mode, mins: r.mins, title: `Walk to ${to.name}`, detail: fmtKm(r.km) }] };
}

// Door to door by metro: first mile → metro (with interchanges) → last mile.
// Stations and first/last-mile modes are picked automatically and can be overridden.
async function metroJourney({ from, to, arriveBy, metro }) {
  metro ||= {};
  const city = metro.city ? await M.getCity(metro.city) : (await M.cityNear(from, 8)) || (await M.cityNear(to, 8));
  if (!city) throw Object.assign(new Error('No metro near these places'), { code: 'nometro' });
  // Pick stations: try a few near each end and keep the pair with the quickest door-to-door estimate
  // (a slightly farther station on a connected line beats the closest one on an unopened line).
  const near = (p, fixed) => (fixed != null ? [M.station(city, fixed)] : M.nearestStations(city, p, 5).filter((s, i, a) => i === 0 || s.dist < a[0].dist + 2.5));
  let best = null;
  for (const a of near(from, metro.fromIdx)) {
    for (const b of near(to, metro.toIdx)) {
      if (a.i === b.i) continue;
      const r = M.route(city, a.i, b.i);
      const score = r.mins + (r.approx ? 60 : 0) + M.km(from, a) * 9 + M.km(b, to) * 9;
      if (!best || score < best.score) best = { a, b, score };
    }
  }
  if (!best) throw Object.assign(new Error('Both places are closest to the same station'), { code: 'same' });
  const fromSt = best.a, toSt = best.b;
  if (fromSt.i === toSt.i) throw Object.assign(new Error('Both places are closest to the same station'), { code: 'same' });
  const firstMode = metro.first || (M.km(from, fromSt) < 1 ? 'walk' : 'auto');
  const lastMode = metro.last || (M.km(toSt, to) < 1 ? 'walk' : 'auto');
  const ride = M.route(city, fromSt.i, toSt.i);
  const rideStart = arriveBy - ride.mins * MIN;
  const [first, last] = await Promise.all([legTime(firstMode, from, fromSt, rideStart - 15 * MIN), legTime(lastMode, toSt, to, arriveBy)]);
  const changes = Math.max(0, ride.segments.length - 1);
  const legs = [
    { mode: firstMode, mins: first.mins, title: `${MODES[firstMode].label} to ${fromSt.name}`, detail: fmtKm(first.km), mile: 'first', km: first.km },
    {
      mode: 'metro', mins: ride.mins, title: `${fromSt.name} → ${toSt.name}`,
      detail: ride.approx ? 'Approximate — line data incomplete here' : `${ride.stops} stops${changes ? ` · ${changes} change${changes > 1 ? 's' : ''}` : ''} · incl. ${M.ENTRY_MINS} min security & wait`,
      segments: ride.segments,
    },
    { mode: lastMode, mins: last.mins, title: `${MODES[lastMode].label} to ${to.name}`, detail: fmtKm(last.km), mile: 'last', km: last.km },
  ];
  return {
    mins: legs.reduce((a, l) => a + l.mins, 0), legs, source: city.system, live: !ride.approx,
    metro: { city: city.id, fromIdx: fromSt.i, toIdx: toSt.i, first: firstMode, last: lastMode },
  };
}

async function busJourney({ from, to, arriveBy }) {
  const road = osrm('car', from, to);
  road.catch(() => {});
  try {
    const target = Math.max(arriveBy, Date.now() + 10 * MIN);
    const p = new URLSearchParams({ fromPlace: `${from.lat},${from.lng}`, toPlace: `${to.lat},${to.lng}`, time: new Date(target).toISOString(), arriveBy: 'true' });
    const [j, r] = await Promise.all([getJSON(`https://api.transitous.org/api/v5/plan?${p}`), road.catch(() => null)]);
    const maxMins = r ? (r.secs / 60) * 3 + 40 : 240;
    const its = (j.itineraries || [])
      .filter((it) => it.legs.some((l) => l.mode === 'BUS' || l.mode === 'COACH'))
      .map((it) => ({ ...it, s: Date.parse(it.startTime), e: Date.parse(it.endTime) }))
      .filter((it) => it.e <= target + MIN && it.e - it.s <= maxMins * MIN && target - it.e <= 45 * MIN)
      .sort((a, b) => b.s - a.s);
    if (its.length) {
      const it = its[0];
      const legs = it.legs.filter((l) => l.mode !== 'WALK' || l.duration >= 120).map((l) => l.mode === 'WALK'
        ? { mode: 'walk', mins: Math.round(l.duration / 60), title: `Walk to ${l.to?.name === 'END' ? to.name : l.to?.name || 'stop'}`, detail: '' }
        : { mode: 'bus', mins: Math.round(l.duration / 60), title: `Bus ${l.routeShortName || ''}`.trim(), detail: `${l.from?.name || ''} → ${l.to?.name || ''}` });
      return { mins: Math.round((it.e - it.s) / MIN), departAt: it.s, arriveAt: it.e, source: 'Transitous timetable', live: true, legs };
    }
  } catch { /* fall through to estimate */ }
  const r = await road;
  const mins = Math.ceil((r.secs * 1.9) / 60) + 12;
  return { mins, distanceKm: r.km, source: 'Estimate', live: false, legs: [{ mode: 'bus', mins, title: `Bus to ${to.name}`, detail: 'No timetable for this route — estimated incl. waiting' }] };
}
