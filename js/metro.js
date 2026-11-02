// Indian metro networks, bundled from Wikidata (tools/build-metro.ps1), routed on the device.
// Timing model: entry + security + wait to board, ride time from distance between stations,
// a few minutes per interchange, and a couple of minutes to exit.

export const ENTRY_MINS = 6;     // walk in, security check, wait for the train
export const EXIT_MINS = 2;      // platform to street
export const TRANSFER_MINS = 5;  // change lines inside one station
const WALK_TRANSFER_MINS = 8;    // change via a walkway between two nearby stations
const SPEED_KMH = 42;            // running speed between stations (DMRC/BMRCL run ~80 km/h max)
const DWELL_MINS = 0.5;

let dataPromise;
const graphs = new Map();

export function loadMetro() {
  dataPromise ||= fetch('data/metro.json').then((r) => r.json());
  return dataPromise;
}

export function km(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export async function getCity(id) {
  const data = await loadMetro();
  return data.cities.find((c) => c.id === id);
}

export async function cities() {
  return (await loadMetro()).cities.map((c) => ({ id: c.id, name: c.name, system: c.system, count: c.stations.length }));
}

export const station = (city, i) => {
  const s = city.stations[i];
  return { i, name: s[0], lat: s[1], lng: s[2], lines: (s[3] || []).map((l) => city.lines[l]) };
};

// The metro city whose network has a station closest to this point (within maxKm).
export async function cityNear(p, maxKm = 6) {
  if (!p) return null;
  const data = await loadMetro();
  let best = null, bestD = Infinity;
  for (const c of data.cities) {
    if (km(p, { lat: c.center[0], lng: c.center[1] }) > 80) continue;
    for (const s of c.stations) {
      const d = km(p, { lat: s[1], lng: s[2] });
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  return bestD <= maxKm ? best : null;
}

export function nearestStations(city, p, n = 3) {
  return city.stations
    .map((s, i) => ({ ...station(city, i), dist: km(p, { lat: s[1], lng: s[2] }) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

function graph(city) {
  if (graphs.has(city.id)) return graphs.get(city.id);
  const adj = new Map(); // key "station:line" -> [{to, cost, ride}]
  const add = (a, b, cost, ride) => { (adj.get(a) || adj.set(a, []).get(a)).push({ to: b, cost, ride }); };
  for (const [a, b, l] of city.edges) {
    const mins = Math.max(1.4, (km(station(city, a), station(city, b)) / SPEED_KMH) * 60 + DWELL_MINS);
    add(`${a}:${l}`, `${b}:${l}`, mins, true);
    add(`${b}:${l}`, `${a}:${l}`, mins, true);
  }
  const linesAt = city.stations.map((s, i) => [...new Set([...(s[3] || []), ...city.edges.filter((e) => e[0] === i || e[1] === i).map((e) => e[2])])]);
  linesAt.forEach((ls, i) => ls.forEach((x) => ls.forEach((y) => x !== y && add(`${i}:${x}`, `${i}:${y}`, TRANSFER_MINS, false))));
  // Interchanges where Wikidata has two separate station items a short walk apart.
  for (let i = 0; i < city.stations.length; i++) {
    for (let j = i + 1; j < city.stations.length; j++) {
      if (km(station(city, i), station(city, j)) > 0.35) continue;
      linesAt[i].forEach((x) => linesAt[j].forEach((y) => { add(`${i}:${x}`, `${j}:${y}`, WALK_TRANSFER_MINS, false); add(`${j}:${y}`, `${i}:${x}`, WALK_TRANSFER_MINS, false); }));
    }
  }
  const g = { adj, linesAt };
  graphs.set(city.id, g);
  return g;
}

// Fastest ride between two stations. Returns { mins, rideMins, stops, segments:[{line, colour, from, to, stops}], approx }
export function route(city, from, to) {
  if (from === to) return { mins: 0, rideMins: 0, stops: 0, segments: [] };
  const { adj, linesAt } = graph(city);
  const dist = new Map(), prev = new Map(), done = new Set();
  const queue = [];
  for (const l of linesAt[from]) { const k = `${from}:${l}`; dist.set(k, 0); queue.push([0, k]); }
  let goal = null;
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, k] = queue.shift();
    if (done.has(k)) continue;
    done.add(k);
    if (+k.split(':')[0] === to) { goal = k; break; }
    for (const e of adj.get(k) || []) {
      const nd = d + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { k, ride: e.ride }); queue.push([nd, e.to]); }
    }
  }
  if (!goal) {
    // Gap in the data: estimate from straight-line distance.
    const d = km(station(city, from), station(city, to));
    const ride = Math.round((d * 1.25 / SPEED_KMH) * 60 + 4);
    return { mins: ride + ENTRY_MINS + EXIT_MINS, rideMins: ride, stops: null, segments: [], approx: true };
  }
  const path = [goal];
  const rides = [];
  for (let k = goal; prev.has(k); k = prev.get(k).k) { path.unshift(prev.get(k).k); rides.unshift(prev.get(k).ride); }
  const segments = [];
  for (let i = 1; i < path.length; i++) {
    if (!rides[i - 1]) continue;
    const [a, l] = path[i - 1].split(':').map(Number), [b] = path[i].split(':').map(Number);
    const mins = Math.max(1.4, (km(station(city, a), station(city, b)) / SPEED_KMH) * 60 + DWELL_MINS);
    const last = segments[segments.length - 1];
    if (last && last.lineIdx === l && last.toIdx === a) { last.toIdx = b; last.stops += 1; last.mins += mins; }
    else segments.push({ lineIdx: l, fromIdx: a, toIdx: b, stops: 1, mins });
  }
  const out = segments.map((s) => ({ line: city.lines[s.lineIdx].name, colour: city.lines[s.lineIdx].colour, from: station(city, s.fromIdx).name, to: station(city, s.toIdx).name, stops: s.stops, mins: Math.round(s.mins) }));
  const ride = Math.round(dist.get(goal));
  return { mins: ride + ENTRY_MINS + EXIT_MINS, rideMins: ride, stops: out.reduce((a, s) => a + s.stops, 0), segments: out };
}
