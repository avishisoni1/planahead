// Backend for "Describe your plan" (Vercel function, free Hobby plan).
//   GET  /api/parse                              → { ready }   whether a Gemini key is configured
//   POST /api/parse { text, today, now, weekday } → trip JSON
// The Gemini key lives only in the GEMINI_API_KEY environment variable; users never see it.
// The prompt and schema are fixed here (api/_gemini.json), so the endpoint can't be used as a general chatbot.
import { readFileSync } from 'node:fs';

const CFG = JSON.parse(readFileSync(new URL('./_gemini.json', import.meta.url), 'utf8'));

// Simple per-instance limit so a shared link can't burn the free quota.
const hits = new Map();
function limited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now(), h = hits.get(ip);
  if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); return false; }
  if (hits.size > 5000) hits.clear();
  return ++h.n > 10;
}

const pick = (v, re, fallback) => (re.test(String(v || '')) ? String(v) : fallback);

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (req.method === 'GET') return res.status(200).json({ ready: Boolean(key) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!key) return res.status(501).json({ error: 'AI is not set up on this server' });
  if (limited(req)) return res.status(429).json({ error: 'Too many requests, try again in a minute' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const text = String(body.text || '').slice(0, 500).trim();
  if (!text) return res.status(400).json({ error: 'Empty plan' });
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString();
  const system = CFG.prompt.join(' ')
    .replace('{today}', pick(body.today, /^\d{4}-\d{2}-\d{2}$/, ist.slice(0, 10)))
    .replace('{now}', pick(body.now, /^\d{2}:\d{2}$/, ist.slice(11, 16)))
    .replace('{weekday}', pick(body.weekday, /^[A-Za-z]{3,9}$/, ''));

  let busy = false;
  for (const model of CFG.models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: CFG.schema },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      try { return res.status(200).json(JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || '{}')); }
      catch { return res.status(502).json({ error: 'Unreadable reply' }); }
    }
    // Retired (404), overloaded (500/503) or out of free quota for this model (429): try the next one.
    if ([404, 429, 500, 503].includes(r.status)) { busy ||= r.status !== 404; continue; }
    return res.status(502).json({ error: 'AI error' });
  }
  res.status(busy ? 429 : 502).json({ error: busy ? 'AI is busy' : 'No Gemini model available' });
}
