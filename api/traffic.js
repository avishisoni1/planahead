// Backend for traffic-aware road times (Vercel function, free Hobby plan) using TomTom's free Routing API.
//   GET  /api/traffic                                   → { ready }
//   POST /api/traffic { from:{lat,lng}, to:{lat,lng}, arriveBy } → { mins, km, delayMins, departAt, arriveAt, kind }
// TomTom predicts traffic for a future arrival from historical speeds per road, weekday and hour,
// and uses live traffic for trips starting soon. The key lives only in TOMTOM_API_KEY.
const hits = new Map();
function limited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now(), h = hits.get(ip);
  if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); return false; }
  if (hits.size > 5000) hits.clear();
  return ++h.n > 30;
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default async function handler(req, res) {
  const key = process.env.TOMTOM_API_KEY;
  if (req.method === 'GET') return res.status(200).json({ ready: Boolean(key) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!key) return res.status(501).json({ error: 'Traffic is not set up on this server' });
  if (limited(req)) return res.status(429).json({ error: 'Too many requests' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const pts = [b.from?.lat, b.from?.lng, b.to?.lat, b.to?.lng].map(num);
  // India only (rough bounding box), so the endpoint can't be used as a general routing service.
  if (pts.includes(null) || ![pts[0], pts[2]].every((x) => x > 6 && x < 36) || ![pts[1], pts[3]].every((x) => x > 68 && x < 98)) {
    return res.status(400).json({ error: 'Bad request' });
  }
  const arriveBy = num(b.arriveBy);
  // TomTom needs a future time; arrivals in the next 20 min (or past) are asked as "leave now".
  const when = arriveBy && arriveBy > Date.now() + 20 * 60000
    ? `arriveAt=${encodeURIComponent(new Date(arriveBy + 5.5 * 3600e3).toISOString().slice(0, 19) + '+05:30')}`
    : 'departAt=now';
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${pts[0]},${pts[1]}:${pts[2]},${pts[3]}/json?key=${key}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&${when}`;
  try {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.routes?.length) return res.status(r.status === 429 || r.status === 403 ? 429 : 502).json({ error: 'Traffic unavailable' });
    const s = j.routes[0].summary;
    const departAt = Date.parse(s.departureTime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json({
      mins: s.travelTimeInSeconds / 60, km: s.lengthInMeters / 1000, delayMins: (s.trafficDelayInSeconds || 0) / 60,
      freeMins: (s.noTrafficTravelTimeInSeconds || s.travelTimeInSeconds) / 60,
      departAt, arriveAt: Date.parse(s.arrivalTime), kind: departAt - Date.now() < 90 * 60000 ? 'live' : 'predicted',
    });
  } catch {
    return res.status(502).json({ error: 'Traffic unavailable' });
  }
}
