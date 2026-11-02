import { render, useState, useEffect, useMemo, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import * as P from './plan.js';
import * as M from './metro.js';
import { MODES, MODE_KEYS, MILE_MODES, getTravel, searchPlaces, legTime, routeKey } from './providers.js';
import * as AI from './ai.js';
import { getState, update, rememberPlace, learnTask, learnedFor, learnTravel, resetAll } from './store.js';
import * as R from './reminders.js';
import {
  html, Icon, ModeIcon, tripIcon, taskIcon, useStore, useNow, go, toast, Toasts, TimeText, hm, PlaceField, StationSheet,
  JourneyBar, LegList, lineInk, Timeline, useTheme, setTheme, buzz, Sheet,
} from './ui.js';

const { MIN } = P;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = (days) => {
  const d = [...days].sort().join('');
  return d === '0123456' ? 'Every day' : d === '12345' ? 'Mon–Fri' : d === '123456' ? 'Mon–Sat' : d === '06' ? 'Weekends' : days.map((x) => DAY_NAMES[x]).join(', ');
};
// "1h 45m", "41m": compact durations for the monospace columns.
const dur = (mins) => { mins = Math.round(mins); return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`; };
const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const partOfDay = (ms) => { const h = new Date(ms).getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'; };

// ---------- Travel times for every mode, recalculated whenever places, time or metro choices change ----------

function useTravelOptions(from, to, target, metro) {
  const [opts, setOpts] = useState({});
  const bucket = Math.round(target / MIN);
  const ready = from && to;
  const run = (modes, dead) => {
    setOpts((o) => ({ ...o, ...Object.fromEntries(modes.map((m) => [m, { ...o[m], loading: true }])) }));
    modes.forEach((m) => getTravel({ from, to, mode: m, arriveBy: target, metro: m === 'metro' ? metro : undefined })
      .then((data) => !dead.v && setOpts((o) => ({ ...o, [m]: { data } })))
      .catch((e) => !dead.v && setOpts((o) => ({ ...o, [m]: { error: e.code || 'fail', message: e.message } }))));
  };
  useEffect(() => {
    if (!ready) { setOpts({}); return; }
    const dead = { v: false };
    const t = setTimeout(() => run(MODE_KEYS.filter((m) => m !== 'metro'), dead), 250);
    return () => { dead.v = true; clearTimeout(t); };
  }, [from?.lat, from?.lng, to?.lat, to?.lng, bucket]);
  useEffect(() => {
    if (!ready) return;
    const dead = { v: false };
    const t = setTimeout(() => run(['metro'], dead), 250);
    return () => { dead.v = true; clearTimeout(t); };
  }, [from?.lat, from?.lng, to?.lat, to?.lng, bucket, JSON.stringify(metro || null)]);
  return opts;
}

const quickPlaces = (s, { home = true } = {}) => [
  ...(home && s.places.home ? [{ ...s.places.home, icon: 'home', label: 'Home', address: s.places.home.name }] : []),
  ...(s.places.work ? [{ ...s.places.work, icon: 'building', label: 'Work / College', address: s.places.work.name }] : []),
  ...s.recents.map((p) => ({ ...p, icon: 'clock' })),
];

// Past trips people may want to repeat: finished ones plus ones already planned, newest first, one per destination.
function recentTrips(s) {
  const seen = new Set();
  return [...s.plans, ...s.history]
    .filter((t) => t.to && t.from)
    .sort((a, b) => b.eventAt - a.eventAt)
    .filter((t) => { const k = (t.title || '') + t.to.name; return !seen.has(k) && seen.add(k); })
    .slice(0, 4);
}

// A trip whose start time is more than an hour gone and was never started on the way.
const isPast = (p, now = Date.now()) => !p.arrivedAt && !p.leftAt && now > p.eventAt + 60 * MIN;

const optError = (code) => (code === 'nometro' ? 'No metro station nearby' : code === 'same' ? 'Same nearest station at both ends' : 'No route found');

function modeSummary(m, d) {
  const km = d.distanceKm ? `${d.distanceKm < 1 ? Math.round(d.distanceKm * 1000) + ' m' : d.distanceKm.toFixed(1) + ' km'}` : '';
  if (m === 'metro') {
    const segs = d.legs[1]?.segments || [];
    const lines = segs.map((s) => s.line.replace(/ Line$/, '').replace(/ Gurgaon$/, '')).join(' · ');
    const changes = Math.max(0, segs.length - 1);
    // Flag when the nearest station is far, so a mostly-cab "metro" trip is obvious.
    const far = Math.max(d.legs[0]?.km || 0, d.legs[2]?.km || 0);
    return `${lines || 'Metro'}${changes ? ` · ${changes} change${changes > 1 ? 's' : ''}` : ''}${far > 5 ? ` · station ${far.toFixed(1)} km away` : ''}`;
  }
  if (m === 'bus') return d.live ? d.legs.filter((l) => l.mode === 'bus').map((l) => l.title).join(' · ') : 'Estimate · no timetable here';
  if (m === 'walk') return km;
  const t = trafficShort(d);
  return m === 'bike' ? `Your own · ${km} · ${t}` : `${km} · ${t}`;
}

const trafficShort = (d) => `${/live/i.test(d.source) ? 'live traffic' : /predicted/i.test(d.source) ? 'predicted traffic' : 'usual traffic'}${/adjusted/.test(d.traffic || '') ? ' · learned' : ''}`;

// The note above the travel options: what kind of traffic the road times are based on.
function trafficNote(opts, tl) {
  const road = ['cab', 'auto', 'bike'].map((m) => opts[m]?.data).find(Boolean);
  const when = `${DAY_NAMES[new Date(tl.leave).getDay()]} ${partOfDay(tl.leave)}`;
  if (!road) return '';
  if (/live/i.test(road.source)) return 'Live traffic';
  if (/predicted/i.test(road.source)) return `Traffic predicted for ${when}`;
  return `Usual ${when} traffic`;
}

function fastest(opts, walkable = true) {
  let best = null, bestM = Infinity;
  for (const m of MODE_KEYS) {
    const d = opts[m]?.data;
    if (d && d.mins < bestM && !(m === 'walk' && (!walkable || d.mins > 40))) { best = m; bestM = d.mins; }
  }
  return best;
}

// ---------- Plan in your words (small, secondary) ----------

let pendingWords = null; // draft handed from the words sheet to the planner

const EMOJI_GUESS = [[/bath|shower/, '🚿'], [/dress|ready|cloth|change/, '👕'], [/eat|breakfast|lunch|dinner|food/, '🍳'], [/chai|coffee|tea/, '☕'], [/pack|bag/, '🎒'],
  [/iron/, '🧺'], [/pooja|puja|pray/, '🪔'], [/cab|auto|book/, '🚕'], [/wake|brush|freshen/, '🪥'], [/revis|study|notes/, '📚'], [/kids|drop/, '🎒'], [/hair|groom|shave/, '💈'], [/make-?up/, '💄']];
const guessEmoji = (n) => (EMOJI_GUESS.find(([re]) => re.test(n.toLowerCase())) || [null, '•'])[1];

async function draftFromWords(r, s) {
  const tpl = P.TEMPLATES.find((t) => t.key === r.templateKey) || P.TEMPLATES.find((t) => t.key === 'blank');
  const base = P.newPlanFrom(tpl, { from: s.places.home || null });
  const plan = { ...base, metro: null, title: r.title || base.title };
  const check = [];
  const d = r.date ? new Date(r.date + 'T00:00') : new Date();
  if (r.time) { const [h, m] = r.time.split(':'); d.setHours(+h, +m, 0, 0); }
  else { const b = new Date(base.eventAt); d.setHours(b.getHours(), b.getMinutes(), 0, 0); check.push('No time found. Set “Arrive by”.'); }
  if (!r.date && d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  plan.eventAt = d.getTime();
  if (r.mode) plan.mode = r.mode;
  if (r.bufferMins != null) plan.buffer = r.bufferMins;
  if (r.tasks.length) {
    const mk = (t) => ({ id: P.uid(), name: t.name, mins: t.mins, emoji: guessEmoji(t.name) });
    plan.tasks = r.tasks.reduce((acc, t) => P.insertInOrder(acc, mk(t)), []);
  }
  const near = s.places.home || null;
  if (r.origin === 'current') { plan.from = null; check.push('Tap the start point → “Use current location”.'); }
  else if (r.origin && r.origin !== 'home') {
    const res = await searchPlaces(r.origin, near).catch(() => []);
    if (res[0]) plan.from = res[0];
  }
  if (r.destination) {
    const res = await searchPlaces(r.destination, plan.from || near).catch(() => []);
    if (res[0]) { plan.to = res[0]; check.push(`“${r.destination}” matched to ${res[0].name}${res[0].address ? ` (${res[0].address.split(',').slice(-2).join(',').trim()})` : ''}. Tap it if that's wrong.`); }
    else check.push(`Couldn't find “${r.destination}”. Pick the place under Where.`);
  } else check.push('Add where you\'re going.');
  if (!plan.from && r.origin !== 'current') check.push('Add where you start from.');
  return { plan, check };
}

const EXAMPLES = [
  'Interview at DLF Cyber Hub tomorrow 11am, bath and breakfast first, going by metro',
  'Flight from Delhi airport T3 on Friday 6:30 pm, cab from home',
  'College kal 9 baje, nashta aur pack bag, auto se',
];

function useAiReady() {
  const [ready, setReady] = useState(null);
  useEffect(() => { AI.aiReady().then(setReady); }, []);
  return ready;
}

function WordsButton({ icon = false }) {
  const [open, setOpen] = useState(false);
  return html`${icon
    ? html`<button class="icon-btn" onClick=${() => setOpen(true)} aria-label="Describe your plan in words" title="Describe in words"><${Icon} name="spark" size=${19} /></button>`
    : html`<button type="button" class="words-link" onClick=${() => setOpen(true)}><${Icon} name="spark" size=${15} /> Describe it in words instead</button>`}
    ${open ? html`<${Sheet} title="Describe your plan" onClose=${() => setOpen(false)}><div class="search"><${AskBox} onDone=${() => setOpen(false)} /></div></${Sheet}>` : ''}`;
}

function AskBox({ onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const aiReady = useAiReady();
  const submit = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); buzz();
    try {
      const r = await AI.parsePlan(text.trim());
      const { plan, check } = await draftFromWords(r, getState());
      pendingWords = { plan, check, text: text.trim(), source: r.source, warning: r.warning, modeGiven: !!r.mode };
      onDone?.();
      go('new/words/' + Date.now().toString(36)); // unique, so it also works from the planner
    } catch { toast('Couldn\'t read that plan. Try adding a time and a place.', 'warn'); }
    setBusy(false);
  };
  return html`<form class="ai" onSubmit=${submit}>
    <p class="ai-head">Say when, where and how. We'll fill in the trip for you to check.${aiReady ? html` <span class="ai-badge">AI</span>` : ''}</p>
    <textarea autofocus value=${text} onInput=${(e) => setText(e.target.value)} placeholder="e.g. Exam at Delhi University tomorrow 9:30am, revise and eat first, by metro" aria-label="Describe your plan in your own words"
      onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }} enterkeyhint="go"></textarea>
    ${!text ? html`<div class="ai-eg">${EXAMPLES.map((x) => html`<button type="button" key=${x} onClick=${() => setText(x)}>${x}</button>`)}</div>` : ''}
    <button class="btn primary block" disabled=${!text.trim() || busy}>${busy ? html`<span class="spinner"></span> Reading…` : 'Fill in my trip'}</button>
  </form>`;
}

// ---------- Shell ----------

function TabBar({ active }) {
  const tab = (key, href, icon, label) => html`<a class=${'tab ' + (active === key ? 'on' : '')} href=${href} aria-current=${active === key ? 'page' : null}><${Icon} name=${icon} size=${22} /><span>${label}</span></a>`;
  return html`<nav class="tabbar" aria-label="Main">
    ${tab('today', '#/', 'alarm', 'Today')}${tab('trips', '#/trips', 'list', 'Trips')}${tab('routines', '#/routines', 'routine', 'Routines')}
  </nav>`;
}

// ---------- Today ----------

function NextCard({ p, now }) {
  const tl = P.buildTimeline(p, p.travel);
  const alarm = R.notifySupported() && Notification.permission === 'granted';
  const started = now >= tl.start, left = now >= tl.leave;
  const total = Math.max(1, tl.prepMins + tl.travelMins + tl.earlyMins);
  return html`<a class="card next" href=${'#/live/' + p.id}>
    <div class="next-top"><span>Next · ${p.title}, ${dayLabel(p.eventAt)}</span>
      <span class=${'status ' + (alarm ? 'good' : 'muted')}><i></i>${alarm ? 'Alarm set' : 'Reminders off'}</span></div>
    <div class="next-times">
      <div><small>${started ? 'Getting ready' : 'Start getting ready'}</small><${TimeText} ms=${tl.start} cls="t-xl" /></div>
      <div class="r"><small>${left ? 'Left at' : 'Leave home'}</small><${TimeText} ms=${tl.leave} cls="t-l accent" /></div>
    </div>
    <div class="bar3" style=${{ gridTemplateColumns: `${tl.prepMins / total}fr ${tl.travelMins / total}fr ${Math.max(tl.earlyMins, 4) / total}fr` }}>
      <i class="b-ink"></i><i class="b-accent"></i><i class="b-good"></i></div>
    <div class="bar3-l">
      <span>Ready · ${dur(tl.prepMins)}</span><span>${MODES[p.mode].label} · ${dur(tl.travelMins)}</span>
      <span class="mono r">${hm(tl.arrive)} → ${hm(tl.event)}</span></div>
    <div class="next-foot"><${ModeIcon} mode=${p.mode} size=${18} /><span>${p.from?.isCurrent ? 'Your location' : p.from?.name || ''} → ${p.to?.name || ''}</span><${Icon} name="chev" size=${18} cls="muted push" /></div>
  </a>`;
}

function Today() {
  const s = useStore();
  const now = useNow(15000);
  const upcoming = s.plans.filter((p) => !p.arrivedAt && !isPast(p, now)).sort((a, b) => a.eventAt - b.eventAt);
  return html`<main class="page">
    <header class="today-head">
      <div><p class="date">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Today</h1></div>
      <a class="round-btn" href="#/settings" aria-label="Settings"><${Icon} name="sliders" /></a>
    </header>

    ${upcoming[0] ? html`<${NextCard} p=${upcoming[0]} now=${now} />` : ''}
    ${upcoming.length > 1 ? html`<div class="card list">${upcoming.slice(1, 3).map((p) => html`<a class="row" href=${'#/live/' + p.id} key=${p.id}>
      <span class="row-ic"><${Icon} name=${tripIcon(p)} /></span><span class="row-main"><b>${p.title}</b><small>${dayLabel(p.eventAt)} · ${p.to?.name || ''}</small></span>
      <span class="row-end mono">${hm(P.buildTimeline(p, p.travel).start)}</span></a>`)}</div>` : ''}

    ${!s.places.home ? html`<div class="card setup">
      <span class="row-ic"><${Icon} name="home" /></span>
      <div class="row-main"><b>Set your home once</b><small>Every trip will start from there.</small></div>
      <${PlaceField} kind="from" label="Home" value=${null} onChange=${(v) => { update((st) => { st.places.home = { ...v, name: v.isCurrent ? 'Home' : v.name }; }); toast('Home saved', 'good'); }} placeholder="Set" compact=${true} />
    </div>` : ''}

    <div class="ask-wrap">
      <a class="card ask" href="#/new/blank/to"><${Icon} name="search" size=${19} /><span>Where do you need to be, and when?</span></a>
      <${WordsButton} />
    </div>

    <section class="sec">
      <div class="sec-head"><h2>Start from a template</h2><a href="#/new/blank">New trip</a></div>
      <div class="card list">${P.TEMPLATES.filter((t) => t.kind === 'occasional' && t.key !== 'blank').map((t) => html`<a class="row" href=${'#/new/' + t.key} key=${t.key}>
        <span class="row-ic plain"><${Icon} name=${tripIcon({ templateKey: t.key })} /></span><span class="row-main"><b>${t.title}</b></span>
        <span class="row-end">${t.buffer >= 60 ? `${t.buffer / 60} h` : `${t.buffer} min`} early</span></a>`)}</div>
    </section>
  </main>`;
}

// ---------- Trips ----------

function Trips() {
  const s = useStore();
  const upcoming = s.plans.filter((p) => !p.arrivedAt).sort((a, b) => a.eventAt - b.eventAt);
  const recents = recentTrips(s).filter((t) => !upcoming.some((u) => u.id === t.id));
  const onTime = s.history.length ? Math.round((s.history.filter((h) => h.onTime).length / s.history.length) * 100) : null;
  return html`<main class="page">
    <header class="page-head"><h1>Trips</h1></header>
    ${onTime != null ? html`<div class="card stats">
      <div><b class="mono">${onTime}%</b><small>on time</small></div><div><b class="mono">${s.history.length}</b><small>trips done</small></div><div><b class="mono">${Object.keys(s.learn).length}</b><small>habits learned</small></div>
    </div>` : ''}
    <section class="sec"><div class="sec-head"><h2>Upcoming</h2><a href="#/new/blank/to">New trip</a></div>
      ${upcoming.length ? html`<div class="card list">${upcoming.map((p) => html`<a class="row" href=${'#/live/' + p.id} key=${p.id}>
        <span class="row-ic"><${Icon} name=${tripIcon(p)} /></span><span class="row-main"><b>${p.title}</b><small>${dayLabel(p.eventAt)} · arrive by ${hm(p.eventAt)} · ${p.to?.name || ''}</small></span>
        ${isPast(p) ? html`<span class="badge muted">Passed</span>` : html`<${Icon} name="chev" size=${18} cls="muted" />`}</a>`)}</div>`
        : html`<p class="empty-line">Nothing planned yet.</p>`}
    </section>
    ${recents.length ? html`<section class="sec"><div class="sec-head"><h2>Plan again</h2></div><div class="card list">
      ${recents.map((t) => html`<a class="row" href=${'#/again/' + t.id} key=${t.id}><span class="row-ic"><${Icon} name=${tripIcon(t)} /></span>
        <span class="row-main"><b>${t.title}</b><small>${t.from.isCurrent ? 'Your location' : t.from.name} → ${t.to.name}</small></span><span class="row-end"><${ModeIcon} mode=${t.mode} size=${18} /></span></a>`)}
    </div></section>` : ''}
    ${s.history.length ? html`<section class="sec"><div class="sec-head"><h2>Past</h2></div><div class="card list">
      ${s.history.slice(0, 30).map((h) => html`<a class="row" href=${h.to ? '#/again/' + h.id : '#/trips'} key=${h.id}><span class="row-ic"><${Icon} name=${tripIcon(h)} /></span>
        <span class="row-main"><b>${h.title}</b><small>${dayLabel(h.eventAt)}</small></span>
        <span class=${'badge ' + (h.onTime ? 'good' : 'warn')}>${h.onTime ? 'On time' : `${h.lateMins} min late`}</span></a>`)}
    </div></section>` : ''}
  </main>`;
}

// ---------- Routines ----------

function Routines() {
  const s = useStore();
  return html`<main class="page">
    <header class="page-head"><h1>Routines</h1><p class="muted">Trips you take often. Plan the next one in a tap.</p></header>
    ${s.routines.length ? html`<div class="card list">${s.routines.map((r) => {
      const next = P.nextOccurrence(r);
      return html`<div class="row" key=${r.id}>
        <span class="row-ic"><${Icon} name=${tripIcon(r)} /></span>
        <a class="row-main" href=${'#/routine/' + r.id}><b>${r.title}</b><small>${daysText(r.days)} · ${r.to?.name || ''}</small></a>
        <a class="pill-btn" href=${'#/routine/' + r.id}>${next ? (['Today', 'Tomorrow'].includes(P.fmtDay(next)) ? P.fmtDay(next) : DAY_NAMES[new Date(next).getDay()]) : 'Plan'} <span class="mono">${r.time}</span></a>
        <button class="icon-btn sm" aria-label=${'Delete ' + r.title} onClick=${() => { update((st) => { st.routines = st.routines.filter((x) => x.id !== r.id); }); toast('Routine removed'); }}><${Icon} name="trash" size=${17} /></button>
      </div>`;
    })}</div>` : html`<div class="card empty-card"><b>No routines yet</b><p class="muted">Turn on “Every week” when you plan a trip, or start from one below.</p></div>`}
    <section class="sec"><div class="sec-head"><h2>Add a routine</h2></div>
      <div class="card list">${P.TEMPLATES.filter((t) => t.kind === 'daily').map((t) => html`<a class="row" href=${'#/new/' + t.key} key=${t.key}>
        <span class="row-ic plain"><${Icon} name=${tripIcon({ templateKey: t.key })} /></span><span class="row-main"><b>${t.title}</b><small>Mon–Fri · arrive ${t.hour}:00</small></span><${Icon} name="plus" size=${18} cls="muted" /></a>`)}
        <a class="row" href="#/new/blank"><span class="row-ic plain"><${Icon} name="pin" /></span><span class="row-main"><b>Something else</b></span><${Icon} name="plus" size=${18} cls="muted" /></a>
      </div>
    </section>
  </main>`;
}

// ---------- New trip ----------

function nextAtSameTime(ms) {
  const d = new Date(), src = new Date(ms);
  d.setHours(src.getHours(), src.getMinutes(), 0, 0);
  if (d.getTime() - Date.now() < 30 * MIN) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function initialPlan(route, s) {
  const [kind, arg] = route;
  if (kind === 'new' && arg === 'words' && pendingWords) {
    const w = pendingWords;
    return { plan: w.plan, words: w, repeat: P.TEMPLATES.find((t) => t.key === w.plan.templateKey)?.kind === 'daily' ? [1, 2, 3, 4, 5] : null };
  }
  const strip = (p) => ({ id: P.uid(), title: p.title, emoji: p.emoji, color: p.color, templateKey: p.templateKey, from: p.from, to: p.to, mode: p.mode, metro: p.metro || null, buffer: p.buffer, tasks: structuredClone(p.tasks || []).map((t) => ({ ...t, id: P.uid() })) });
  if (kind === 'plan') {
    const p = s.plans.find((x) => x.id === arg);
    if (p) return { plan: structuredClone(p), editingId: p.id, repeat: s.routines.find((r) => r.id === p.routineId)?.days || null };
  }
  if (kind === 'routine') {
    const r = s.routines.find((x) => x.id === arg);
    if (r) return { plan: { ...strip(r), eventAt: P.nextOccurrence(r) || P.defaultEventTime(), routineId: r.id }, routine: r, repeat: r.days };
  }
  if (kind === 'again') {
    const h = [...s.history, ...s.plans].find((x) => x.id === arg);
    if (h?.to) return { plan: { ...strip(h), eventAt: nextAtSameTime(h.eventAt) }, again: true };
  }
  const tpl = P.TEMPLATES.find((t) => t.key === arg) || P.TEMPLATES.find((t) => t.key === 'blank');
  const plan = { ...P.newPlanFrom(tpl, { from: s.places.home || null }), metro: null };
  if (tpl.key === 'blank') { plan.mode = s.settings.lastMode || 'cab'; if (s.settings.defaultBuffer != null) plan.buffer = s.settings.defaultBuffer; }
  if (['college', 'office'].includes(tpl.key) && s.places.work) plan.to = s.places.work;
  return { plan, repeat: tpl.kind === 'daily' ? [1, 2, 3, 4, 5] : null };
}

function Stepper({ value, onChange, step = 5, min = 0, max = 600, label }) {
  const dec = () => onChange(Math.max(min, value <= step && value > 1 ? value - 1 : value - step));
  const inc = () => onChange(Math.min(max, value < step ? value + 1 : value + step));
  return html`<div class="stepper" role="group" aria-label=${label}>
    <button type="button" onClick=${dec} aria-label=${'Less time for ' + label}><${Icon} name="minus" size=${15} /></button>
    <label class="mono"><input type="number" inputmode="numeric" min=${min} max=${max} value=${value}
      onChange=${(e) => onChange(Math.min(max, Math.max(min, parseInt(e.target.value, 10) || 0)))} aria-label=${'Minutes for ' + label} /><span class="unit">min</span></label>
    <button type="button" onClick=${inc} aria-label=${'More time for ' + label}><${Icon} name="plus" size=${15} /></button>
  </div>`;
}

// Steps before leaving: drag the grip (or use arrow keys on it) to reorder.
function Tasks({ tasks, onChange }) {
  const [name, setName] = useState('');
  const [drag, setDrag] = useState(null); // { i, startY, dy, over, rects }
  const listRef = useRef();
  const setTask = (id, patch) => onChange(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const add = (n, mins = 10, emoji = '') => {
    n = n.trim();
    if (!n) return;
    const learned = learnedFor(n);
    onChange(P.insertInOrder(tasks, { id: P.uid(), name: n, mins: learned ? Math.round(learned.avg) : mins, emoji: emoji || guessEmoji(n) }));
    setName(''); buzz();
  };
  const moveTo = (i, j) => { if (i === j) return; const t = [...tasks]; const [x] = t.splice(i, 1); t.splice(j, 0, x); onChange(t); buzz(); };
  const down = (e, i) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = [...listRef.current.querySelectorAll(':scope > .task')].map((r) => r.getBoundingClientRect());
    setDrag({ i, startY: e.clientY, dy: 0, over: i, rects });
  };
  const moveP = (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const r = drag.rects[drag.i], mid = r.top + r.height / 2 + dy;
    let over = drag.rects.findIndex((x) => mid < x.top + x.height);
    if (over < 0) over = drag.rects.length - 1;
    setDrag({ ...drag, dy, over });
  };
  const up = () => { if (drag) moveTo(drag.i, drag.over); setDrag(null); };
  const shift = (idx) => {
    if (!drag) return 0;
    if (idx === drag.i) return drag.dy;
    const h = drag.rects[drag.i].height;
    if (drag.over > drag.i && idx > drag.i && idx <= drag.over) return -h;
    if (drag.over < drag.i && idx < drag.i && idx >= drag.over) return h;
    return 0;
  };
  const sugg = P.SUGGESTIONS.filter(([n]) => !tasks.some((t) => t.name.toLowerCase() === n.toLowerCase())).slice(0, 5);
  return html`<div class="card list tasks" ref=${listRef}>
    ${tasks.map((t, i) => {
      const l = learnedFor(t.name);
      const hint = l && Math.abs(Math.round(l.avg) - t.mins) >= 3 ? Math.round(l.avg) : null;
      return html`<div class=${'task' + (drag?.i === i ? ' dragging' : '')} key=${t.id} style=${{ transform: drag ? `translateY(${shift(i)}px)` : '' }}>
        <button type="button" class="grip" aria-label=${'Reorder ' + t.name + '. Use arrow keys to move.'}
          onPointerDown=${(e) => down(e, i)} onPointerMove=${moveP} onPointerUp=${up} onPointerCancel=${() => setDrag(null)}
          onKeyDown=${(e) => { if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); moveTo(i, i - 1); } if (e.key === 'ArrowDown' && i < tasks.length - 1) { e.preventDefault(); moveTo(i, i + 1); } }}>
          <${Icon} name="grip" size=${18} /></button>
        <span class="task-ic"><${Icon} name=${taskIcon(t.name)} size=${18} /></span>
        <div class="task-main">
          <input class="task-name" value=${t.name} onInput=${(e) => setTask(t.id, { name: e.target.value })} aria-label="Step name" />
          ${hint ? html`<button type="button" class="learn" onClick=${() => setTask(t.id, { mins: hint })}>You usually take ${hint} min · use it</button>` : ''}
        </div>
        <${Stepper} value=${t.mins} onChange=${(v) => setTask(t.id, { mins: v })} label=${t.name} />
        <button type="button" class="task-x" onClick=${() => { onChange(tasks.filter((x) => x.id !== t.id)); buzz(); }} aria-label=${'Remove ' + t.name}><${Icon} name="x" size=${15} /></button>
      </div>`;
    })}
    <form class="task-add" onSubmit=${(e) => { e.preventDefault(); add(name); }}>
      <${Icon} name="plus" size=${18} />
      <input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Add a step" aria-label="Add a step" enterkeyhint="done" />
      ${name.trim() ? html`<button class="btn sm">Add</button>` : ''}
    </form>
  </div>
  ${sugg.length ? html`<div class="chips">${sugg.map(([n, m, e]) => html`<button type="button" class="chip dashed" onClick=${() => add(n, m, e)} key=${n}><${Icon} name=${taskIcon(n)} size=${15} />${n} · ${m} min</button>`)}</div>` : ''}`;
}

// 12-hour time picker: hour, minutes (5-minute steps) and am/pm, all one tap each.
function TimeSheet({ value, onPick, onClose }) {
  const d = new Date(value);
  const [h, setH] = useState(d.getHours() % 12 || 12);
  const [m, setM] = useState(d.getMinutes());
  const [pm, setPm] = useState(d.getHours() >= 12);
  const set = () => { const n = new Date(value); n.setHours((h % 12) + (pm ? 12 : 0), m, 0, 0); onPick(n.getTime()); };
  return html`<${Sheet} title="Arrive by" onClose=${onClose}>
    <div class="picker">
      <div class="pk-preview mono">${h}:${String(m).padStart(2, '0')}<small>${pm ? 'pm' : 'am'}</small></div>
      <div class="seg" role="radiogroup" aria-label="Morning or evening">
        <button type="button" role="radio" aria-checked=${!pm} class=${!pm ? 'on' : ''} onClick=${() => setPm(false)}>AM</button>
        <button type="button" role="radio" aria-checked=${pm} class=${pm ? 'on' : ''} onClick=${() => setPm(true)}>PM</button>
      </div>
      <span class="pk-label">Hour</span>
      <div class="pk-grid" role="radiogroup" aria-label="Hour">${[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((x) => html`<button type="button" key=${x} role="radio" aria-checked=${h === x} class=${'mono' + (h === x ? ' on' : '')} onClick=${() => setH(x)}>${x}</button>`)}</div>
      <span class="pk-label">Minutes</span>
      <div class="pk-grid" role="radiogroup" aria-label="Minutes">${[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((x) => html`<button type="button" key=${x} role="radio" aria-checked=${m === x} class=${'mono' + (m === x ? ' on' : '')} onClick=${() => setM(x)}>:${String(x).padStart(2, '0')}</button>`)}</div>
      <button class="btn primary block" onClick=${set}>Set ${h}:${String(m).padStart(2, '0')} ${pm ? 'pm' : 'am'}</button>
    </div>
  </${Sheet}>`;
}

// Month calendar; past days can't be picked.
function DateSheet({ value, onPick, onClose }) {
  const sel = new Date(value);
  const [month, setMonth] = useState(new Date(sel.getFullYear(), sel.getMonth(), 1));
  const today0 = new Date().setHours(0, 0, 0, 0);
  const first = month.getDay(), days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const shift = (k) => setMonth(new Date(month.getFullYear(), month.getMonth() + k, 1));
  return html`<${Sheet} title="Pick a date" onClose=${onClose}>
    <div class="picker">
      <div class="dp-head">
        <button type="button" class="icon-btn" onClick=${() => shift(-1)} disabled=${month <= thisMonth} aria-label="Previous month"><${Icon} name="back" /></button>
        <b>${month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b>
        <button type="button" class="icon-btn" onClick=${() => shift(1)} aria-label="Next month"><${Icon} name="chev" /></button>
      </div>
      <div class="dp-grid">
        ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => html`<span class="dp-wd" key=${'w' + i}>${x}</span>`)}
        ${Array.from({ length: first }, (_, i) => html`<span key=${'b' + i}></span>`)}
        ${Array.from({ length: days }, (_, i) => {
          const dt = new Date(month.getFullYear(), month.getMonth(), i + 1);
          const past = dt.getTime() < today0, on = dt.toDateString() === sel.toDateString(), isToday = dt.getTime() === today0;
          return html`<button type="button" key=${i} class=${'dp-day' + (on ? ' on' : '') + (isToday ? ' today' : '')} disabled=${past}
            aria-label=${dt.toDateString()} aria-pressed=${on} onClick=${() => onPick(dt)}>${i + 1}</button>`;
        })}
      </div>
    </div>
  </${Sheet}>`;
}

function ArriveCard({ plan, set }) {
  const [sheet, setSheet] = useState(null);
  const d = new Date(plan.eventAt);
  const setDate = (dt) => { const n = new Date(dt); n.setHours(d.getHours(), d.getMinutes(), 0, 0); set({ eventAt: n.getTime() }); };
  const day = (k) => { const x = new Date(); x.setDate(x.getDate() + k); return x; };
  const isDay = (k) => d.toDateString() === day(k).toDateString();
  const other = !isDay(0) && !isDay(1);
  const BUFS = [0, 5, 10, 15, 20, 30, 60, 120];
  return html`<div class="card arrive">
    <div class="arrive-top">
      <button type="button" class="big-time" onClick=${() => setSheet('time')} aria-label=${'Arrive by ' + P.fmtTime(plan.eventAt) + '. Change time'}>
        <${TimeText} ms=${plan.eventAt} cls="t-big" /><${Icon} name="down" size=${18} cls="muted" /></button>
    </div>
    <div class="day-chips" role="radiogroup" aria-label="Day">
      <button type="button" role="radio" aria-checked=${isDay(0)} class=${'chip' + (isDay(0) ? ' on' : '')} onClick=${() => setDate(day(0))}>Today</button>
      <button type="button" role="radio" aria-checked=${isDay(1)} class=${'chip' + (isDay(1) ? ' on' : '')} onClick=${() => setDate(day(1))}>Tomorrow</button>
      <button type="button" role="radio" aria-checked=${other} class=${'chip' + (other ? ' on' : '')} onClick=${() => setSheet('date')}><${Icon} name="calendar" size=${15} />${other ? dayLabel(plan.eventAt) : 'Pick a date'}</button>
    </div>
    ${sheet === 'time' ? html`<${TimeSheet} value=${plan.eventAt} onClose=${() => setSheet(null)} onPick=${(v) => { set({ eventAt: v }); setSheet(null); buzz(); }} />` : ''}
    ${sheet === 'date' ? html`<${DateSheet} value=${plan.eventAt} onClose=${() => setSheet(null)} onPick=${(dt) => { setDate(dt); setSheet(null); buzz(); }} />` : ''}
    <div class="arrive-early">
      <span class="label">Arrive early by</span>
      <div class="seg scroll" role="radiogroup" aria-label="Arrive early by">${[...BUFS, ...(BUFS.includes(plan.buffer) ? [] : [plan.buffer])].map((b) => html`<button type="button" role="radio" aria-checked=${plan.buffer === b} key=${b} class=${plan.buffer === b ? 'on' : ''} onClick=${() => set({ buffer: b })}>${b === 0 ? '0' : b >= 60 ? `${b / 60} h` : `${b} min`}</button>`)}</div>
    </div>
  </div>`;
}

function Fixes({ plan, tl, opts, set, now }) {
  const lateBy = Math.ceil((now - tl.start) / MIN);
  const fixes = [];
  MODE_KEYS.forEach((m) => {
    const d = opts[m]?.data;
    if (m === plan.mode || !d) return;
    const alt = P.buildTimeline({ ...plan, mode: m }, d);
    if (alt.start > tl.start + 2 * MIN) fixes.push({ label: `${MODES[m].label} instead · start ${hm(alt.start)}`, fix: () => set({ mode: m }), gain: alt.start - tl.start });
  });
  fixes.sort((a, b) => b.gain - a.gain).splice(2);
  if (plan.buffer > 0) fixes.push({ label: `Less buffer · ${Math.max(0, plan.buffer - lateBy)} min`, fix: () => set({ buffer: Math.max(0, plan.buffer - lateBy) }) });
  if (tl.prepMins > 10) {
    const factor = Math.max(0.5, (tl.prepMins - lateBy) / tl.prepMins);
    fixes.push({ label: `Rush prep · ${Math.round(tl.prepMins * factor)} min`, fix: () => set((p) => ({ tasks: p.tasks.map((t) => ({ ...t, mins: Math.max(1, Math.round(t.mins * factor)) })) })) });
  }
  return html`<div class="alert warn">
    <b>${tl.event < now ? 'That time has already passed.' : `You should have started ${P.fmtDur(lateBy)} ago.`}</b>
    <div class="chips">${tl.event < now
      ? html`<button type="button" class="chip" onClick=${() => set({ eventAt: plan.eventAt + 864e5 })}>Move to tomorrow</button>`
      : fixes.map((f) => html`<button type="button" class="chip" onClick=${f.fix} key=${f.label}>${f.label}</button>`)}</div>
  </div>`;
}

function MetroCityPick({ onPick }) {
  const [list, setList] = useState([]);
  useEffect(() => { M.cities().then(setList); }, []);
  return html`<label class="select inset"><span>Choose metro</span><select value="" onChange=${(e) => onPick(e.target.value)}>
    <option value="" disabled>Select a city</option>${list.map((c) => html`<option value=${c.id}>${c.name} · ${c.system}</option>`)}</select><${Icon} name="down" size=${16} /></label>`;
}

function Planner({ route }) {
  const s = useStore();
  const init = useMemo(() => initialPlan(route, getState()), [route.join('/')]);
  const [plan, setPlan] = useState(init.plan);
  const [repeat, setRepeat] = useState(init.repeat || null);
  const [modeTouched, setModeTouched] = useState(!!init.editingId || !!init.again || !!init.routine || !!init.words?.modeGiven);
  const [routeOpen, setRouteOpen] = useState(false);
  const now = useNow(30000);
  const set = (patch) => setPlan((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) }));

  const target = plan.eventAt - plan.buffer * MIN;
  const opts = useTravelOptions(plan.from, plan.to, target, plan.metro);
  const sel = opts[plan.mode];
  const travel = sel?.data;
  const ready = !!(plan.from && plan.to);
  const tl = useMemo(() => P.buildTimeline(plan, travel), [plan, travel]);
  const late = tl.start < now - MIN;

  // If the suggested mode isn't possible here (e.g. no metro nearby), switch to the fastest that is.
  useEffect(() => {
    if (modeTouched || !sel?.error) return;
    const best = fastest(opts);
    if (best) set({ mode: best });
  }, [sel?.error, opts]);

  // Walking is offered only when the places are close (~2.5 km, about 30 min). It still appears
  // inside metro and bus journeys for the short stretches to and from stations.
  const walkable = ready && M.km(plan.from, plan.to) <= 2.5;
  const shownModes = MODE_KEYS.filter((m) => m !== 'walk' || walkable || plan.mode === 'walk');
  const fastestMode = fastest(opts, walkable);
  const mileAlt = useMileAlts(plan, travel, tl, plan.mode === 'metro' && !!travel?.metro);
  const pickMode = (m) => { setModeTouched(true); set({ mode: m }); buzz(); };

  const save = async () => {
    if (!plan.to) return toast('Add where you are going first', 'warn');
    if (!plan.from) return toast('Add where you are starting from', 'warn');
    if (!travel && sel?.loading) return toast('Still working out travel time…');
    const record = { ...plan, travel: travel || null, metro: travel?.metro || plan.metro || null, title: plan.title.trim() || `Trip to ${plan.to.name}`, done: init.editingId ? plan.done || {} : {}, createdAt: Date.now() };
    update((st) => {
      st.plans = [...st.plans.filter((p) => p.id !== record.id), record];
      st.settings.lastMode = plan.mode;
      if (repeat?.length) {
        const r = { id: plan.routineId || P.uid(), title: record.title, emoji: plan.emoji, time: P.toHHMM(plan.eventAt), days: [...repeat].sort(), from: plan.from, to: plan.to, mode: plan.mode, metro: record.metro, buffer: plan.buffer, tasks: plan.tasks, color: plan.color, templateKey: plan.templateKey };
        st.routines = [...st.routines.filter((x) => x.id !== r.id), r];
        record.routineId = r.id;
      }
    });
    rememberPlace(plan.to);
    const perm = await R.ensurePermission();
    toast(perm === 'granted' ? 'Trip saved. We\'ll remind you at each step.' : 'Trip saved. Use “Add to calendar” for alarms when the app is closed.', 'good');
    go('live/' + record.id);
  };

  const pickTemplate = (t) => { set({ title: t.title, emoji: t.emoji, tasks: t.tasks(), buffer: t.buffer, mode: t.mode, templateKey: t.key, color: P.templateColor(t.key), eventAt: P.defaultEventTime(t.hour) }); setRepeat(t.kind === 'daily' ? [1, 2, 3, 4, 5] : null); setModeTouched(false); };
  const isNew = !init.editingId && !init.routine && !init.again && !init.words;

  return html`<main class="page planner">
    <header class="bar">
      <button class="text-btn" onClick=${() => (history.length > 1 ? history.back() : go(''))}>Cancel</button>
      <div class="bar-title">${init.editingId ? 'Edit trip' : init.routine ? 'Routine' : init.again ? 'Plan again' : init.words ? 'Check your trip' : 'New trip'}</div>
      ${!init.editingId ? html`<${WordsButton} icon=${true} />` : html`<span class="icon-btn ghost"></span>`}
    </header>

    ${init.words ? html`<div class="card note"><${Icon} name="spark" size=${17} /><div>
      <b>Filled in from your words · ${init.words.source}</b>
      <q>${init.words.text}</q>
      ${init.words.warning ? html`<p class="warn-t">${init.words.warning}</p>` : ''}
      ${init.words.check.length ? html`<ul>${init.words.check.map((c) => html`<li key=${c}>${c}</li>`)}</ul>` : ''}
    </div></div>` : ''}

    ${isNew ? html`<div class="chips scroll" aria-label="Trip types">${P.TEMPLATES.filter((t) => t.key !== 'blank').map((t) => html`<button type="button" class=${'chip ' + (plan.templateKey === t.key ? 'on' : '')} onClick=${() => pickTemplate(t)} key=${t.key}><${Icon} name=${tripIcon({ templateKey: t.key })} size=${15} /> ${t.title}</button>`)}</div>` : ''}

    <section class="sec">
      <h3 class="label">Trip name</h3>
      <div class="card name-row"><span class="row-ic"><${Icon} name=${tripIcon(plan)} /></span>
        <input value=${plan.title} placeholder="What's it for? e.g. Office, Interview" onInput=${(e) => set({ title: e.target.value })} aria-label="Trip name" /></div>
    </section>

    <section class="sec">
      <h3 class="label">Where</h3>
      <div class="card where">
        <${PlaceField} kind="from" label="Starting from" value=${plan.from} sub=${plan.from && s.places.home && plan.from.id === s.places.home.id ? 'Home' : ''} onChange=${(v) => set({ from: v, metro: null })} near=${plan.to} quick=${quickPlaces(s)} placeholder="Where you'll start" />
        <${PlaceField} kind="to" label="Going to" value=${plan.to} onChange=${(v) => set({ to: v, metro: null })} near=${plan.from} quick=${quickPlaces(s, { home: false })} placeholder="Search a place in India" autoFocus=${route[2] === 'to'} allowCurrent=${false} />
        <button type="button" class="swap" aria-label="Swap start and destination" onClick=${() => { set({ from: plan.to, to: plan.from, metro: null }); buzz(); }} disabled=${!plan.from && !plan.to}><${Icon} name="swap" size=${18} /></button>
      </div>
      ${plan.from && !plan.from.isCurrent && !s.places.home ? html`<button type="button" class="link" onClick=${() => { update((st) => { st.places.home = plan.from; }); toast('Saved as Home'); }}>Save “${plan.from.name}” as Home</button>` : ''}
    </section>

    <section class="sec">
      <h3 class="label">Arrive by</h3>
      <${ArriveCard} plan=${plan} set=${set} />
    </section>

    <section class="sec">
      <h3 class="label">Getting there ${ready ? html`<span class="label-note">${trafficNote(opts, tl)}</span>` : ''}</h3>
      ${!ready ? html`<div class="card empty-card"><p class="muted">Add where you're going. Every option's time and leave-by time is worked out for you.</p></div>`
        : html`<div class="tiles" role="radiogroup" aria-label="Travel options">
        ${shownModes.map((m) => {
          const o = opts[m], d = o?.data, on = plan.mode === m, loading = !o || o.loading;
          const leave = d ? P.buildTimeline({ ...plan, mode: m }, d).leave : null;
          return html`<button type="button" key=${m} role="radio" aria-checked=${on} class=${'tile' + (on ? ' on' : '') + (o?.error ? ' na' : '')} onClick=${() => pickMode(m)}>
            ${fastestMode === m ? html`<span class="tile-tag">Fastest</span>` : ''}
            <${ModeIcon} mode=${m} size=${22} />
            <span class="tile-l">${MODES[m].label}</span>
            <b class="tile-t mono">${d ? dur(d.mins) : loading ? html`<i class="skel"></i>` : '—'}</b>
            <small class="tile-s">${d ? `leave ${hm(leave)}` : o?.error ? 'Not here' : ' '}</small>
          </button>`;
        })}
      </div>
      ${(() => {
        if (!sel || (sel.loading && !travel)) return '';
        const leave = travel ? P.buildTimeline(plan, travel).leave : null;
        return html`<div class="card mode-panel">
          <div class="mp-head"><span class="row-ic"><${ModeIcon} mode=${plan.mode} size=${19} /></span>
            <span class="mp-body"><b>${MODES[plan.mode].label}${travel ? ` · ${P.fmtDur(travel.mins)}` : ''}</b><small>${travel ? modeSummary(plan.mode, travel) : optError(sel.error)}</small></span>
            ${leave ? html`<span class="mp-leave"><small>Leave</small><b class="mono">${hm(leave)}</b></span>` : ''}</div>
          ${travel ? html`<${JourneyBar} travel=${travel} /><${LegList} travel=${travel} after=${plan.mode === 'metro' && travel.metro
            ? (l) => (l.mile ? html`<${MileChoice} which=${l.mile} cur=${l.mode} alt=${mileAlt} onPick=${(x) => set({ metro: { ...travel.metro, [l.mile]: x } })} />` : '') : null} />
            <button type="button" class="btn block" onClick=${() => setRouteOpen(true)}>${plan.mode === 'metro' ? 'See full route · change stations' : 'See full route'}<${Icon} name="chev" size=${16} /></button>` : ''}
          ${plan.mode === 'metro' && sel.error ? html`<${MetroCityPick} onPick=${(c) => set({ metro: { city: c } })} />` : ''}
        </div>`;
      })()}`}
    </section>

    <section class="sec">
      <h3 class="label">Before you leave <span class="label-note mono">${dur(tl.prepMins)}</span></h3>
      <${Tasks} tasks=${plan.tasks} onChange=${(tasks) => set({ tasks })} />
    </section>

    <section class="sec">
      <h3 class="label">Repeat</h3>
      <div class="card repeat">
        <label class="toggle"><span><b>Every week</b><small>Saved under Routines · plan it again in one tap</small></span>
          <input type="checkbox" checked=${!!repeat} onChange=${(e) => setRepeat(e.target.checked ? [1, 2, 3, 4, 5] : null)} /><span class="toggle-ui"></span></label>
        ${repeat ? html`<div class="days">${P.WEEKDAYS.map((d, i) => html`<button type="button" key=${i} class=${repeat.includes(i) ? 'on' : ''} aria-pressed=${repeat.includes(i)} aria-label=${DAY_NAMES[i]} onClick=${() => setRepeat(repeat.includes(i) ? repeat.filter((x) => x !== i) : [...repeat, i])}>${d}</button>`)}</div>` : ''}
      </div>
    </section>

    <section class="sec">
      <h3 class="label">Your plan</h3>
      ${late ? html`<${Fixes} plan=${plan} tl=${tl} opts=${opts} set=${set} now=${now} />` : ''}
      <div class="card"><${Timeline} plan=${plan} tl=${tl} travel=${travel} /></div>
    </section>

    <div class=${'dock ' + (late ? 'late' : '')}>
      <div class="dock-times">
        <div><span>Start${late ? ' · late' : ''}</span><b><${TimeText} ms=${tl.start} /></b></div>
        <div><span>Leave</span><b class="accent">${ready ? html`<${TimeText} ms=${tl.leave} />` : '—'}</b></div>
      </div>
      <button class="btn primary" onClick=${save} disabled=${!plan.to}>${init.editingId ? 'Save' : 'Save trip'}</button>
    </div>

    ${routeOpen && travel ? html`<${RouteView} plan=${plan} travel=${travel} tl=${tl} setMetro=${(x) => set({ metro: x })}
      onClose=${() => setRouteOpen(false)} onUse=${() => { setModeTouched(true); setRouteOpen(false); }} />` : ''}
  </main>`;
}

// ---------- Route detail ----------

// A vertical walk-through of the journey: leave home, each station and interchange, and arrival,
// with stations and the first/last stretch (walk, auto, cab, bike) changeable for metro trips.
// Times for walk / auto / cab / bike to and from the metro stations, so the choice shows what each costs.
function useMileAlts(plan, travel, tl, enabled) {
  const [alt, setAlt] = useState({ first: {}, last: {} });
  const m = travel?.metro;
  useEffect(() => {
    if (!enabled || !m || travel.legs?.length !== 3) return;
    let dead = false;
    setAlt({ first: {}, last: {} });
    M.getCity(m.city).then((city) => {
      const a = M.station(city, m.fromIdx), b = M.station(city, m.toIdx);
      MILE_MODES.forEach((x) => {
        legTime(x, plan.from, a, tl.leave).then((r) => !dead && setAlt((s) => ({ ...s, first: { ...s.first, [x]: r.mins } }))).catch(() => {});
        legTime(x, b, plan.to, tl.arrive).then((r) => !dead && setAlt((s) => ({ ...s, last: { ...s.last, [x]: r.mins } }))).catch(() => {});
      });
    });
    return () => { dead = true; };
  }, [enabled, m?.city, m?.fromIdx, m?.toIdx, plan.from?.lat, plan.to?.lat]);
  return alt;
}

// "Change" link that reveals walk / auto / cab / bike for getting to or from a station.
function MileChoice({ which, cur, alt, onPick }) {
  const [open, setOpen] = useState(false);
  return html`<div class="mile-choice">
    <button type="button" class="mile-change" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? 'Close' : 'Change'}<${Icon} name=${open ? 'up' : 'down'} size=${14} /></button>
    ${open ? html`<div class="seg mile" role="radiogroup" aria-label=${which === 'first' ? 'Get to the station by' : 'From the station by'}>
      ${MILE_MODES.map((x) => html`<button type="button" key=${x} role="radio" aria-checked=${cur === x} class=${cur === x ? 'on' : ''}
        onClick=${() => { onPick(x); setOpen(false); buzz(); }}>${MODES[x].label}${alt[which][x] != null ? html` <span class="mono">${alt[which][x]}m</span>` : ''}</button>`)}</div>` : ''}
  </div>`;
}

function RouteView({ plan, travel, tl, setMetro, onClose, onUse, readOnly = false }) {
  const [picking, setPicking] = useState(null);
  const m = travel.metro;
  const isMetro = plan.mode === 'metro' && m && travel.legs.length === 3;
  const alt = useMileAlts(plan, travel, tl, isMetro && !readOnly);

  const mileSeg = (which, cur) => (readOnly ? '' : html`<${MileChoice} which=${which} cur=${cur} alt=${alt} onPick=${(x) => setMetro({ ...m, [which]: x })} />`);
  const station = (name, which) => html`<button type="button" class="r-station" disabled=${readOnly} onClick=${() => setPicking(which)}>${name}${readOnly ? '' : html`<${Icon} name="down" size=${14} />`}</button>`;

  const rows = [];
  let t = tl.leave;
  const home = getState().places.home;
  const fromName = plan.from?.isCurrent ? 'your location' : home && plan.from?.id === home.id ? 'home' : plan.from?.name || 'start';
  if (isMetro) {
    const [first, ride, last] = travel.legs;
    const segs = ride.segments || [];
    rows.push({ t, mark: 'ring', line: first.mode === 'walk' ? 'walk' : 'road', body: html`<b>Leave ${fromName}</b>${plan.from?.address ? html`<small>${plan.from.address}</small>` : ''}
      <span class="r-note">${MODES[first.mode].label} ${first.detail} · ${first.mins} min</span>${mileSeg('first', first.mode)}` });
    t += first.mins * MIN;
    let board = t + M.ENTRY_MINS * MIN;
    if (!segs.length) rows.push({ t, mark: 'ring', line: 'metro', body: html`${station(ride.title.split(' → ')[0], 'from')}<small>${ride.detail}</small>` });
    segs.forEach((sg, i) => {
      const chip = html`<span class="line-chip" style=${{ background: sg.colour, color: lineInk(sg.colour) }}>${sg.line}</span>`;
      const info = html`<small>${sg.stops} stop${sg.stops > 1 ? 's' : ''} · ${sg.mins} min</small>`;
      if (i === 0) {
        rows.push({ t, mark: 'ring', colour: sg.colour, line: 'metro', body: html`${station(sg.from, 'from')}
          <small>Security & platform · allow ${M.ENTRY_MINS} min</small>${chip}${info}` });
      } else {
        rows.push({ t: board, mark: 'ring', colour: sg.colour, line: 'metro', body: html`<b>${sg.from}</b>
          <span class="r-change">Change · ${M.TRANSFER_MINS} min to the ${sg.line}</span>${chip}${info}` });
        board += M.TRANSFER_MINS * MIN;
      }
      board += sg.mins * MIN;
    });
    if (segs.length) {
      const lastSeg = segs[segs.length - 1];
      rows.push({ t: tl.arrive - last.mins * MIN, mark: 'ring', colour: lastSeg.colour, line: last.mode === 'walk' ? 'walk' : 'road', body: html`${station(lastSeg.to, 'to')}
        <small>Exit · then ${MODES[last.mode].label.toLowerCase()} ${last.detail} · ${last.mins} min</small>${mileSeg('last', last.mode)}` });
    }
  } else {
    travel.legs.forEach((l, i) => {
      const line = l.mode === 'walk' ? 'walk' : l.mode === 'bus' ? 'bus' : 'road';
      const head = i === 0 ? html`<b>Leave ${fromName}</b>${plan.from?.address ? html`<small>${plan.from.address}</small>` : ''}` : html`<b>${l.title}</b>`;
      rows.push({ t, mark: 'ring', line, body: html`${head}<span class="r-note">${i === 0 ? `${l.title} · ` : ''}${l.detail ? `${l.detail} · ` : ''}${l.mins} min</span>` });
      t += l.mins * MIN;
    });
  }
  rows.push({ t: tl.arrive, mark: 'square', body: html`<b>${plan.to?.name}</b><small class="good">${tl.earlyMins > 0 ? `${tl.earlyMins} min before ${hm(tl.event)}` : `Right at ${hm(tl.event)}`}</small>` });

  return html`<div class="overlay" role="dialog" aria-modal="true" aria-label="Route">
    <div class="page">
      <header class="bar"><button class="icon-btn" onClick=${onClose} aria-label="Back"><${Icon} name="back" /></button><div class="bar-title">${MODES[plan.mode].label} route</div><span class="icon-btn ghost"></span></header>
      <div class="route-top">
        <div class="route-times"><b class="mono">${hm(tl.leave)} – ${hm(tl.arrive)}</b><span class="mono">${dur(tl.travelMins)}</span></div>
        <${JourneyBar} travel=${travel} />
        <p class=${'src ' + (travel.live ? 'live' : 'est')}>${travel.live ? 'Calculated from' : 'Estimate ·'} ${travel.source}${travel.fetchedAt ? ` · updated ${P.fmtRel(travel.fetchedAt)}` : ''}</p>
      </div>
      <ol class="rlist">${rows.map((r, i) => html`<li class="r-row" key=${i}>
        <span class="r-t mono">${hm(r.t)}</span>
        <span class="r-rail"><i class=${'r-mark ' + r.mark} style=${r.colour ? { borderColor: r.colour } : {}}></i>${i < rows.length - 1 ? html`<i class=${'r-line ' + (r.line || 'walk')} style=${r.colour && r.line === 'metro' ? { background: r.colour } : {}}></i>` : ''}</span>
        <div class="r-body">${r.body}</div>
      </li>`)}</ol>
    </div>
    ${readOnly ? '' : html`<div class="dock two"><button class="btn" onClick=${onClose}>Other routes</button><button class="btn primary" onClick=${onUse}>Use this route</button></div>`}
    ${picking ? html`<${StationSheet} title=${picking === 'from' ? 'Board at' : 'Get off at'} cityId=${m.city} near=${picking === 'from' ? plan.from : plan.to}
      onClose=${() => setPicking(null)} onCity=${(id) => { setMetro({ city: id }); setPicking(null); }}
      onPick=${(i) => {
        // A different station changes the distance, so walk/auto for that side is re-picked.
        const next = { ...m, [picking === 'from' ? 'fromIdx' : 'toIdx']: i };
        delete next[picking === 'from' ? 'first' : 'last'];
        setMetro(next); setPicking(null);
      }} />` : ''}
  </div>`;
}

// ---------- Live trip (focus screen) ----------

function Live({ id }) {
  const s = useStore();
  const now = useNow(1000);
  const p = s.plans.find((x) => x.id === id);
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const setP = (fn) => update((st) => { st.plans = st.plans.map((x) => (x.id === id ? { ...x, ...fn(x) } : x)); });

  const refresh = async (manual) => {
    if (!p?.from || !p?.to || refreshing) return;
    setRefreshing(true);
    try {
      const before = P.buildTimeline(p, p.travel);
      const t = await getTravel({ from: p.from, to: p.to, mode: p.mode, arriveBy: p.eventAt - p.buffer * MIN, metro: p.metro, fresh: true });
      const after = P.buildTimeline(p, t);
      setP(() => ({ travel: t }));
      const delta = Math.round((before.leave - after.leave) / MIN);
      if (Math.abs(delta) >= 2) {
        const msg = delta > 0 ? `Leave ${delta} min earlier (${P.fmtTime(after.leave)}). Travel is slower now.` : `You can leave ${-delta} min later (${P.fmtTime(after.leave)}).`;
        toast(msg, delta > 0 ? 'warn' : 'good');
        if (!manual) R.notify('🚦 Leave time changed', msg, 'traffic');
      } else if (manual) toast('Travel time is up to date');
    } catch { if (manual) toast('Could not refresh travel time', 'warn'); }
    setRefreshing(false);
  };

  // Recheck road traffic every 12 min (bus every 15) in the 2 hours before leaving. Metro and walking
  // don't depend on traffic, so they aren't rechecked; this keeps the free traffic quota for road trips.
  useEffect(() => {
    if (!p) return;
    const every = { cab: 12, auto: 12, bike: 12, bus: 15 }[p.mode];
    if (!every) return;
    const tick = () => {
      const tl = P.buildTimeline(p, p.travel);
      const age = Date.now() - (p.travel?.fetchedAt || 0);
      if (!p.leftAt && tl.leave - Date.now() < 120 * MIN && tl.leave > Date.now() - 10 * MIN && age > every * MIN) refresh(false);
    };
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, [p?.id, p?.travel?.fetchedAt, p?.leftAt]);

  if (!p) return html`<main class="page"><header class="bar"><a class="icon-btn" href="#/"><${Icon} name="back" /></a></header><div class="card empty-card"><p>This trip is no longer here.</p><a class="btn primary" href="#/">Go to Today</a></div></main>`;

  const tl = P.buildTimeline(p, p.travel);
  const done = p.done || {};
  const tasks = tl.steps.filter((x) => x.kind === 'task');
  const cur = tasks.find((t) => !done[t.id]);
  const curIdx = cur ? tasks.indexOf(cur) : tasks.length;
  const lastDone = Math.max(p.startedAt || 0, ...Object.values(done));
  const began = cur ? (lastDone ? Math.min(lastDone, now) : Math.min(cur.at, now)) : now;
  const reminders = R.notifySupported() && Notification.permission === 'granted';

  const markDone = (t, skip = false) => {
    const actual = (Date.now() - began) / MIN;
    if (!skip && actual >= 1 && actual <= t.mins * 3 + 30) learnTask(t.name, Math.round(actual));
    setP((x) => ({ done: { ...x.done, [t.id]: Date.now() } }));
    buzz();
  };
  const addFive = (t) => { setP((x) => ({ tasks: x.tasks.map((k) => (k.id === t.id ? { ...k, mins: k.mins + 5 } : k)) })); buzz(); };
  const finish = (onTime, diff) => {
    update((st) => {
      st.history = [{ id: p.id, title: p.title, emoji: p.emoji, color: p.color, templateKey: p.templateKey, eventAt: p.eventAt, from: p.from, to: p.to, mode: p.mode, metro: p.metro, buffer: p.buffer, tasks: p.tasks, onTime, lateMins: Math.max(0, -diff) }, ...st.history].slice(0, 200);
      st.plans = st.plans.filter((x) => x.id !== p.id);
    });
    go('');
  };

  const firstLeg = p.travel?.legs?.[0];
  const leaveLabel = p.mode === 'metro' && p.travel?.legs?.[1] ? `Leave for ${p.travel.legs[1].title.split(' → ')[0]} metro` : `Leave for ${p.to?.name || 'your trip'}`;
  const upcomingRows = (fromIdx) => html`<ol class="f-list">
    ${tasks.slice(fromIdx).map((t) => html`<li key=${t.id}><span class="mono">${hm(t.at)}</span><span class="with-ic"><${Icon} name=${taskIcon(t.name)} size=${17} />${t.name}</span><span class="mono dim">${t.mins} min</span></li>`)}
    <li class="leave"><span class="mono">${hm(tl.leave)}</span><span>${leaveLabel}</span><span></span></li>
  </ol>`;

  // Short countdown text: "21:59" under an hour, "2h 05m" beyond that.
  const span = (secs) => (Math.abs(secs) >= 3600 ? dur(Math.abs(secs) / 60) : P.fmtClock(Math.abs(secs)));
  let status = { cls: 'good', txt: 'On track' }, phase, body, hint = '';
  const stale = isPast(p, now);
  if (stale) {
    // The trip's time is long gone without "I've left": don't run a timer, offer to plan it again.
    phase = 'Missed';
    status = { cls: 'muted', txt: `${P.fmtDay(tl.event)} · ${hm(tl.event)}` };
    body = html`<h1 class="f-title">This trip has passed</h1>
      <p class="f-sub">${p.title} was at ${P.fmtTime(tl.event)}, ${dayLabel(tl.event)}. Plan it again for the next time you go.</p>
      <button class="f-btn" onClick=${() => go('again/' + p.id)}>Plan it again</button>
      <div class="f-two"><button onClick=${() => finish(true, 0)}>I went · mark done</button><button onClick=${() => { update((st) => { st.plans = st.plans.filter((x) => x.id !== p.id); }); go(''); toast('Trip removed'); }}>Remove trip</button></div>`;
  } else if (p.arrivedAt) {
    const diff = Math.round((tl.event - p.arrivedAt) / MIN);
    phase = 'Arrived';
    body = html`<h1 class="f-title">${diff >= 0 ? (diff ? `${P.fmtDur(diff)} to spare` : 'Right on time') : `Late by ${P.fmtDur(-diff)}`}</h1>
      <p class="f-sub">${diff >= 0 ? 'Nice. Your step timings get more accurate every trip.' : 'Your step timings were updated, so next time you\'ll start earlier.'}</p>
      <button class="f-btn" onClick=${() => finish(diff >= 0, diff)}>Done</button>`;
    status = diff >= 0 ? { cls: 'good', txt: 'Made it' } : { cls: 'warn', txt: 'Late' };
  } else if (p.leftAt) {
    const eta = p.leftAt + (tl.arrive - tl.leave);
    phase = 'On the way';
    body = html`<h1 class="f-title">To ${p.to?.name}</h1>
      <div class="f-count"><span class="mono">${hm(eta)}</span><small>expected arrival</small></div>
      <div class="f-prog"><i style=${{ width: `${Math.min(100, ((now - p.leftAt) / Math.max(1, eta - p.leftAt)) * 100)}%` }}></i></div>
      <div class="f-prog-l mono"><span>${hm(p.leftAt)}</span><span>${hm(eta)}</span></div>
      <button class="f-btn" onClick=${() => {
        // Teach the app how long this route really takes at this hour (road trips only).
        if (['cab', 'auto', 'bike'].includes(p.mode) && p.travel) learnTravel(routeKey(p.mode, p.from, p.to, p.eventAt - p.buffer * MIN), (Date.now() - p.leftAt) / MIN, p.travel.mins);
        setP(() => ({ arrivedAt: Date.now() }));
      }}>I've reached</button>`;
    if (eta > tl.event) status = { cls: 'warn', txt: `About ${P.fmtDur((eta - tl.event) / MIN)} late` };
  } else if (cur && (now >= tl.start - MIN || p.startedAt || Object.keys(done).length)) {
    const remaining = (began + cur.mins * MIN - now) / 1000;
    const remainingPrep = tasks.filter((t) => !done[t.id] && t !== cur).reduce((a, t) => a + t.mins, 0);
    const behind = Math.round((now + Math.max(0, remaining * 1000) + remainingPrep * MIN - tl.leave) / MIN);
    const next = tasks[curIdx + 1];
    phase = `Now · step ${curIdx + 1} of ${tasks.length}`;
    if (behind > 0) {
      status = { cls: 'warn', txt: `${P.fmtDur(behind)} behind` };
      hint = p.mode === 'metro' && firstLeg?.mode === 'walk'
        ? `Running late? Take an auto to the station instead of walking to make up time.`
        : `Running late? Shorten the next step or skip one to still leave by ${hm(tl.leave)}.`;
    } else hint = `You're on track to leave at ${hm(tl.leave)}.`;
    body = html`<h1 class="f-title with-ic"><span class="f-step-ic"><${Icon} name=${taskIcon(cur.name)} size=${22} /></span>${cur.name}</h1>
      <div class=${'f-count' + (remaining < 0 ? ' over' : '')}><span class="mono">${span(remaining)}</span><small>${remaining < 0 ? 'over time' : `left · until ${hm(began + cur.mins * MIN)}`}</small></div>
      <div class="f-prog"><i style=${{ width: `${Math.min(100, Math.max(0, (1 - remaining / (cur.mins * 60)) * 100))}%` }}></i></div>
      <button class="f-btn" onClick=${() => markDone(cur)}>Done — ${next ? `next, ${next.name}` : 'time to leave'}</button>
      <div class="f-two"><button onClick=${() => addFive(cur)}>+5 min</button><button onClick=${() => markDone(cur, true)}>Skip step</button></div>
      ${upcomingRows(curIdx + 1)}`;
  } else if (cur) {
    const far = tl.start - now > 180 * MIN;
    phase = `Up next · ${cur.name}`;
    status = { cls: 'muted', txt: P.fmtRel(tl.start, now).replace(/^in /, 'Starts in ') };
    body = html`<h1 class="f-title">Start getting ready</h1>
      <div class="f-count">${far ? html`<span class="mono">${hm(tl.start)}</span><small>${P.fmtDay(tl.start).toLowerCase()} · ${P.fmtRel(tl.start, now)}</small>` : html`<span class="mono">${span((tl.start - now) / 1000)}</span><small>to go · at ${hm(tl.start)}</small>`}</div>
      <button class="f-btn" onClick=${() => { setP(() => ({ startedAt: Date.now() })); buzz(); }}>Start now</button>
      <div class="f-two"><button onClick=${() => R.downloadICS(p, tl)}>Add to calendar</button><button onClick=${() => setRouteOpen(true)}>View route</button></div>
      ${upcomingRows(0)}`;
    hint = reminders ? `We'll remind you at ${hm(tl.start)} and before each step.` : 'Turn on reminders from the ··· menu, or add the trip to your calendar.';
  } else {
    const toLeave = (tl.leave - now) / 1000;
    phase = 'Next · Leave';
    if (toLeave < 0) status = { cls: 'warn', txt: `${P.fmtDur(-toLeave / 60)} past leave time` };
    body = html`<h1 class="f-title">${leaveLabel}</h1>
      <div class=${'f-count' + (toLeave < 0 ? ' over' : '')}><span class="mono">${span(toLeave)}</span><small>${toLeave < 0 ? 'late · leave now' : `to leave · at ${hm(tl.leave)}`}</small></div>
      <button class="f-btn accent" onClick=${() => { setP(() => ({ leftAt: Date.now() })); buzz(); }}>I've left</button>
      <div class="f-two"><button onClick=${() => setRouteOpen(true)}>View route</button><button onClick=${() => refresh(true)}>Recheck traffic</button></div>`;
  }

  return html`<main class="focus">
    <header class="f-head">
      <a class="icon-btn" href="#/" aria-label="Close"><${Icon} name="x" /></a>
      <div class="f-trip">${p.title} · ${dayLabel(p.eventAt)}</div>
      <div class="f-actions">
      ${!p.arrivedAt ? html`<a class="edit-btn" href=${'#/plan/' + p.id}><${Icon} name="edit" size=${16} />Edit</a>` : ''}
      <div class="menu-wrap">
        <button class="icon-btn" onClick=${() => setMenu(!menu)} aria-label="More options" aria-expanded=${menu}><${Icon} name="more" /></button>
        ${menu ? html`<div class="menu" onClick=${() => setMenu(false)}>
          <a href=${'#/plan/' + p.id}><${Icon} name="edit" size=${18} /> Edit trip</a>
          <button onClick=${() => setRouteOpen(true)}><${Icon} name="metro" size=${18} /> View route</button>
          <button onClick=${() => R.downloadICS(p, tl)}><${Icon} name="calendar" size=${18} /> Add to calendar</button>
          ${!reminders && R.notifySupported() ? html`<button onClick=${async () => { const r = await R.ensurePermission(); toast(r === 'granted' ? 'Reminders are on' : 'Notifications are blocked. Use Add to calendar instead.', r === 'granted' ? 'good' : 'warn'); }}><${Icon} name="bell" size=${18} /> Turn on reminders</button>` : ''}
          <button class="danger" onClick=${() => { update((st) => { st.plans = st.plans.filter((x) => x.id !== p.id); }); go(''); toast('Trip deleted'); }}><${Icon} name="trash" size=${18} /> Delete trip</button>
        </div>` : ''}
      </div>
      </div>
    </header>
    <div class="f-phase"><span>${phase}</span><span class=${'status ' + status.cls}><i></i>${status.txt}</span></div>
    ${body}
    ${!p.arrivedAt && !stale && p.travel ? html`<div class="f-route" role="button" tabindex="0" onClick=${() => setRouteOpen(true)} onKeyDown=${(e) => e.key === 'Enter' && setRouteOpen(true)}>
      <${ModeIcon} mode=${p.mode} size=${18} /><span><b>${MODES[p.mode].label} · ${dur(tl.travelMins)}</b><small>Leave ${hm(tl.leave)} · arrive ${hm(tl.arrive)} · ${['cab', 'auto', 'bike'].includes(p.mode) ? trafficShort(p.travel) + ' · ' : ''}updated ${P.fmtRel(p.travel.fetchedAt, now)}</small></span>
      <button class="icon-btn sm" aria-label="Recheck travel time" onClick=${(e) => { e.stopPropagation(); refresh(true); }}><${Icon} name="refresh" size=${17} cls=${refreshing ? 'spin' : ''} /></button></div>` : ''}
    ${hint ? html`<p class="f-hint">${hint}</p>` : ''}
    ${routeOpen && p.travel ? html`<${RouteView} plan=${p} travel=${p.travel} tl=${tl} readOnly=${true} onClose=${() => setRouteOpen(false)} />` : ''}
  </main>`;
}

// ---------- Settings ----------

function Settings() {
  const s = useStore();
  const [confirming, setConfirming] = useState(false);
  const theme = useTheme();
  const perm = R.notifySupported() ? Notification.permission : 'unsupported';
  return html`<main class="page">
    <header class="bar"><a class="icon-btn" href="#/" aria-label="Back"><${Icon} name="back" /></a><div class="bar-title">Settings</div><span class="icon-btn ghost"></span></header>
    <section class="sec"><h3 class="label">Saved places</h3>
      <div class="card where">
        <${PlaceField} kind="from" label="Home" value=${s.places.home} sub="Home" onChange=${(v) => update((st) => { st.places.home = { ...v, name: v.isCurrent ? 'Home' : v.name }; })} placeholder="Set your home" />
        <${PlaceField} kind="to" label="Work / College" value=${s.places.work} sub="Work" onChange=${(v) => update((st) => { st.places.work = v; })} placeholder="Set work or college" allowCurrent=${false} />
      </div>
    </section>
    <section class="sec"><h3 class="label">Appearance</h3>
      <div class="seg" role="radiogroup" aria-label="Theme">
        ${[['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'auto_theme', 'Auto']].map(([k, ic, l]) => html`<button key=${k} role="radio" aria-checked=${theme === k} class=${theme === k ? 'on' : ''} onClick=${() => setTheme(k)}><${Icon} name=${ic} size=${16} /> ${l}</button>`)}
      </div>
    </section>
    <section class="sec"><h3 class="label">Arrive early by (default)</h3>
      <div class="seg scroll">${[0, 5, 10, 15, 20, 30].map((b) => html`<button key=${b} class=${(s.settings.defaultBuffer ?? 10) === b ? 'on' : ''} onClick=${() => update((st) => { st.settings.defaultBuffer = b; })}>${b ? b + ' min' : '0'}</button>`)}</div>
    </section>
    <section class="sec"><h3 class="label">Reminders</h3>
      <div class="card pad">
        <p class="muted small">${perm === 'granted' ? 'Notifications are on.' : perm === 'denied' ? 'Notifications are blocked in your browser settings.' : perm === 'unsupported' ? 'This browser can\'t show notifications.' : 'Notifications are off.'} For alarms when the app is closed, use “Add to calendar” on a trip.</p>
        ${perm === 'default' ? html`<button class="btn" onClick=${() => R.ensurePermission()}>Turn on notifications</button>` : ''}
        ${perm === 'granted' ? html`<button class="btn" onClick=${() => R.notify('⏰ PlanAhead', 'Reminders are working.')}>Send a test</button>` : ''}
      </div>
    </section>
    <section class="sec"><h3 class="label">About the data</h3>
      <div class="card pad"><p class="muted small">Free, no sign-up. Places from OpenStreetMap. Cab, auto and bike times use TomTom traffic (predicted for your travel time, live on the day) when available, otherwise usual Indian city traffic, and they adjust to your own past trips. Bus timetables from Transitous, and metro lines & stations for 18 Indian cities from Wikidata. “Describe it in words” is read by Google Gemini AI, so avoid personal details there. Your trips stay on this phone.</p></div>
    </section>
    ${confirming
      ? html`<div class="alert warn"><b>Delete all trips, routines and learned timings on this phone?</b><div class="row-btns"><button class="btn danger" onClick=${() => { resetAll(); setConfirming(false); toast('All data cleared'); }}>Delete everything</button><button class="btn" onClick=${() => setConfirming(false)}>Cancel</button></div></div>`
      : html`<button class="btn ghost danger" onClick=${() => setConfirming(true)}>Clear all data</button>`}
  </main>`;
}

// ---------- App ----------

function useRoute() {
  const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [r, set] = useState(parse());
  useEffect(() => {
    const f = () => { set(parse()); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}

function App() {
  const route = useRoute();
  const s = useStore();

  useEffect(() => {
    R.clearScheduled();
    s.plans.filter((p) => !p.arrivedAt && !p.leftAt).forEach((p) => R.schedule(p, P.buildTimeline(p, p.travel)));
  }, [s.plans]);
  useEffect(() => { M.loadMetro(); }, []);

  let view, tab = null;
  if (['new', 'plan', 'routine', 'again'].includes(route[0])) view = html`<${Planner} route=${route} key=${route.join('/')} />`;
  else if (route[0] === 'live') view = html`<${Live} id=${route[1]} key=${route[1]} />`;
  else if (route[0] === 'settings') view = html`<${Settings} />`;
  else if (route[0] === 'trips') { view = html`<${Trips} />`; tab = 'trips'; }
  else if (route[0] === 'routines') { view = html`<${Routines} />`; tab = 'routines'; }
  else { view = html`<${Today} />`; tab = 'today'; }
  return html`<div class=${'app ' + (tab ? 'with-tabs' : '') + (route[0] === 'live' ? ' is-focus' : '')}>${view}${tab ? html`<${TabBar} active=${tab} />` : ''}<${Toasts} /></div>`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
