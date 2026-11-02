// "Plan in your words": turns a sentence into a trip draft.
// Gemini runs only on the backend (api/parse.js when hosted, serve.ps1 locally), so the key never
// reaches users' phones. Without a backend key, the built-in offline reader is used instead.
import { TEMPLATES, SUGGESTIONS } from './plan.js';

// Shape every reader returns. Times are local.
// { title, emoji, templateKey, date:'YYYY-MM-DD'|null, time:'HH:MM'|null, destination, origin:'home'|'current'|string|null,
//   mode, bufferMins, tasks:[{name, mins}], source }

const MODES = ['metro', 'cab', 'auto', 'bike', 'bus', 'walk'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Whether the backend has a Gemini key (GET /api/parse → { ready }).
let readyPromise;
export function aiReady() {
  readyPromise ||= fetch('api/parse', { cache: 'no-store' })
    .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : {}))
    .then((j) => !!j.ready)
    .catch(() => false);
  return readyPromise;
}

// Only the sentence and the phone's date/time go to the backend; the prompt lives on the server.
async function viaServer(text) {
  const d = new Date();
  const r = await fetch('api/parse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, today: iso(d), now: d.toTimeString().slice(0, 5), weekday: d.toLocaleDateString('en-IN', { weekday: 'long' }) }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw Object.assign(new Error(j?.error || 'AI unavailable'), { status: r.status });
  return j;
}

function normalise(raw, source) {
  const tpl = TEMPLATES.find((t) => t.key === raw.category) || TEMPLATES.find((t) => t.key === 'blank');
  return {
    title: raw.title || tpl.title, emoji: tpl.emoji, templateKey: tpl.key,
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : null,
    time: /^\d{1,2}:\d{2}$/.test(raw.time || '') ? raw.time.padStart(5, '0') : null,
    destination: (raw.destination || '').trim() || null,
    origin: (raw.origin || '').trim() || null,
    mode: MODES.includes(raw.mode) ? raw.mode : null,
    bufferMins: Number.isFinite(raw.bufferMins) && raw.bufferMins > 0 ? raw.bufferMins : null,
    tasks: (raw.tasks || []).filter((t) => t?.name).map((t) => ({ name: String(t.name).trim(), mins: Math.max(1, Math.min(240, Math.round(t.mins) || 10)) })),
    source,
  };
}

export async function parsePlan(text) {
  if (await aiReady()) {
    try { return normalise(await viaServer(text), 'Gemini AI'); }
    catch (e) {
      const local = localParse(text);
      local.warning = e.status === 429 ? 'AI is busy right now, so the built-in reader filled this in.' : 'AI was unavailable, so the built-in reader filled this in.';
      return local;
    }
  }
  return localParse(text);
}

// ---------- Built-in offline reader ----------

const CATEGORY_WORDS = [
  ['interview', /interview/], ['exam', /exam|test\b|paper\b|viva/], ['flight', /flight|airport|plane|fly\b/], ['train', /train|railway|station\b.*(train|rail)|rajdhani|shatabdi|vande/],
  ['party', /wedding|shaadi|party|birthday|reception|sangeet|dinner with/], ['doctor', /doctor|hospital|clinic|dentist|appointment/],
  ['college', /college|class\b|classes|lecture|university|school|tuition|coaching/], ['office', /office|work\b|meeting|shift/], ['gym', /gym|workout|yoga class/],
];
const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TASK_WORDS = [
  ...SUGGESTIONS.map(([n, m]) => [n.toLowerCase().split(/[ /]/)[0], n, m]).filter(([w]) => !['get', 'drop'].includes(w)),
  ['shower', 'Bath', 15], ['nahana', 'Bath', 15], ['breakfast', 'Breakfast', 15], ['lunch', 'Lunch', 20], ['dinner', 'Dinner', 25], ['nashta', 'Breakfast', 15],
  ['ready', 'Get ready', 20], ['dress', 'Get dressed', 15], ['revise', 'Revision', 30], ['revision', 'Revision', 30], ['pack', 'Pack bag', 10], ['makeup', 'Make-up', 20],
  ['shave', 'Shave', 10], ['puja', 'Pooja', 10], ['tea', 'Chai / coffee', 10], ['chai', 'Chai / coffee', 10], ['coffee', 'Chai / coffee', 10],
];

export function localParse(text) {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const raw = { category: 'blank', title: '', date: '', time: '', destination: '', origin: '', mode: '', bufferMins: 0, tasks: [] };

  const cat = CATEGORY_WORDS.find(([, re]) => re.test(t));
  if (cat) { raw.category = cat[0]; raw.title = TEMPLATES.find((x) => x.key === cat[0]).title; }

  // Date
  const d = new Date();
  if (/day after tomorrow|parso/.test(t)) d.setDate(d.getDate() + 2);
  else if (/tomorrow|tmrw|\bkal\b/.test(t)) d.setDate(d.getDate() + 1);
  else {
    const wd = WEEK.findIndex((w) => t.includes(w) || t.includes(` ${w.slice(0, 3)} `));
    const md = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/) || t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})/);
    if (md) {
      const [day, mon] = /^\d/.test(md[1]) ? [+md[1], md[2]] : [+md[2], md[1]];
      d.setMonth(MONTHS.indexOf(mon), day);
      if (d < new Date(new Date().setHours(0, 0, 0, 0))) d.setFullYear(d.getFullYear() + 1);
    } else if (wd >= 0) {
      d.setDate(d.getDate() + (((wd - d.getDay() + 7) % 7) || 7));
    }
  }
  raw.date = iso(d);

  // Time ("11am", "at 9:30", "by 10.15 pm", "noon")
  let tm = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) || t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:baje|o'?clock)/) || t.match(/\b(?:at|by|before|till)\s+(\d{1,2})(?:[:.](\d{2}))?\b/);
  if (/\bnoon\b/.test(t)) tm = ['', '12', '00', 'pm'];
  if (tm) {
    let h = +tm[1]; const m = +(tm[2] || 0); const ap = (tm[3] || '').replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 6) h += 12; // "at 5" usually means 5 pm
    if (h < 24 && m < 60) raw.time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Mode
  const modes = [['metro', /metro/], ['cab', /\bcab\b|uber|ola\b|taxi|car\b/], ['auto', /\bauto\b|rickshaw/], ['bike', /\bbike\b|scooty|scooter|two.?wheeler/], ['bus', /\bbus\b/], ['walk', /\bwalk(ing)?\b|paidal/]];
  raw.mode = (modes.find(([, re]) => re.test(t)) || [''])[0];

  // Buffer ("15 min early")
  const buf = t.match(/(\d{1,3})\s*(?:min|mins|minutes)\s*(?:early|before|pehle)/) || t.match(/(\d)\s*(?:hr|hrs|hour|hours)\s*(?:early|before)/);
  if (buf) raw.bufferMins = /h/.test(buf[0].replace(/\d/g, '').trim()[0] || '') ? +buf[1] * 60 : +buf[1];

  // Origin
  if (/from (my )?(home|ghar|house|flat|pg|hostel)/.test(t)) raw.origin = 'home';
  else if (/from here|from (my )?current/.test(t)) raw.origin = 'current';
  else { const fm = t.match(/\bfrom ([a-z0-9 .'-]+?)(?=,| to | by | at | on | tomorrow| today|\.|$)/); if (fm) raw.origin = fm[1].trim(); }

  // Destination: "at/to/in <place>" that isn't a time
  const stop = '(?=,| by | at \\d| on | from | tomorrow| today| kal| and | for | with |\\.|\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm)|$)';
  const orig = ` ${text.replace(/\s+/g, ' ')} `; // same length as t, keeps the user's capitals (DLF, IIT)
  const asTyped = (s, from = 0) => { const i = t.indexOf(s, from); return (i < 0 ? s : orig.slice(i, i + s.length)).trim(); };
  const dm = t.match(new RegExp(`\\b(?:to|at|in|reach)\\s+(?!\\d)([a-z0-9][a-z0-9 .'&-]{2,60}?)${stop}`));
  if (dm && !/^(home|the|my|time)$/.test(dm[1].trim())) raw.destination = asTyped(dm[1], dm.index);
  // "flight from Delhi airport" / "train from NDLS station": that place is where they're going.
  const hub = t.match(/\b([a-z0-9][a-z0-9 .'-]{1,40}?\s(?:airport|station|terminal|junction|railway station)(?:\s+t\d)?)\b/);
  if (hub && (!raw.destination || ['flight', 'train'].includes(raw.category))) {
    raw.destination = asTyped(hub[1].replace(/^.*\b(?:from|at|to|reach|for)\s+/, ''), hub.index);
    if (raw.origin && hub[1].includes(raw.origin)) raw.origin = 'home';
  }
  if (raw.destination && raw.destination === raw.destination.toLowerCase()) raw.destination = raw.destination.replace(/\b\w/g, (c) => c.toUpperCase());

  // Tasks, with "bath 20 min" style durations
  const seen = new Set();
  for (const [word, name, mins] of TASK_WORDS) {
    const re = new RegExp(`\\b${word}\\w*(?:\\s*(?:for|in)?\\s*(\\d{1,3})\\s*(?:min|mins|minutes))?`);
    const m = t.match(re);
    if (m && !seen.has(name)) { seen.add(name); raw.tasks.push({ name, mins: m[1] ? +m[1] : mins }); }
  }
  if (!raw.title) raw.title = raw.destination || 'Trip';
  return normalise(raw, 'Built-in reader');
}
