// Shared UI: icons, hooks, toasts, sheets, place search, metro station picker, journey pieces and the day timeline.
import { html, useState, useEffect, useRef, useMemo } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import * as P from './plan.js';
import * as M from './metro.js';
import { MODES, searchPlaces, reverseGeocode, currentPosition } from './providers.js';
import { getState, subscribe } from './store.js';

export { html };

// Line icons, 24×24, drawn with the current text colour.
const ICONS = {
  metro: '<rect x="5" y="3" width="14" height="14" rx="3.5"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><path d="M9 14h.01M15 14h.01"/>',
  car: '<path d="M4 16v-3.2l1.8-4.6A2 2 0 0 1 7.7 7h8.6a2 2 0 0 1 1.9 1.2l1.8 4.6V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M4 12.5h16M6.5 17v2M17.5 17v2M7.5 14.5h.01M16.5 14.5h.01"/>',
  auto: '<path d="M4 16V11a6 6 0 0 1 6-6h5l3 6h1.5a1.5 1.5 0 0 1 1.5 1.5V16"/><path d="M4 11h14M10 5v6"/><circle cx="7" cy="17" r="2"/><circle cx="17.5" cy="17" r="2"/><path d="M9 17h6.5"/>',
  scooter: '<circle cx="6" cy="17" r="2.6"/><circle cx="18" cy="17" r="2.6"/><path d="M8.6 17h5.2l2.6-9h2.6M15.2 8 14 5h-2.5"/>',
  bus: '<rect x="4.5" y="3.5" width="15" height="14" rx="3"/><path d="M4.5 10.5h15M7.5 20.5v-3M16.5 20.5v-3M8 14h.01M16 14h.01"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m9.5 21 2-6.5 2.8 2.6V21M8 12l2.2-4 3.6.8 1.8 3.2 2.4.8M10.2 8l-1.6 6.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  briefcase: '<rect x="3.5" y="7" width="17" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17"/>',
  file: '<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
  plane: '<path d="M10.5 13.5 3 11l1.5-1.5 7.5 1 4-4.5c.8-.8 2.2-1 3-.2.8.8.6 2.2-.2 3l-4.5 4 1 7.5L13.8 22l-2.5-7.5-3.3 3 .5 2.5L7 21l-1.5-3L2.5 16.5 4 15l2.5.5 3-3"/>',
  stetho: '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/><path d="M5 3h2M13 3h2"/>',
  cap: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  train: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8.5 20l1.5-4M15.5 20l-1.5-4M9 13h.01M15 13h.01"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 4 8 4.5 7 8 12 8ZM12 8s1.5-4 4-3.5S17 8 12 8Z"/>',
  alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M4 4.5 6.5 2.5M20 4.5l-2.5-2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  routine: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4h4M12 8v4l3 2"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  swap: '<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9.5 7V4.5h5V7"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  spark: '<path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  auto_theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5Z" fill="currentColor"/>',
};
Object.assign(ICONS, {
  shower: '<path d="M5 21V8a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4"/><path d="M10 12h8"/><path d="M11 15.5v.5M14 15.5v1.5M17 15.5v.5M12.5 19.5v.5M15.5 19.5v.5"/>',
  shirt: '<path d="M8.5 3.5 4 6l1.8 4 2.2-1v11.5h8V9l2.2 1L20 6l-4.5-2.5a3.5 3.5 0 0 1-7 0Z"/>',
  utensils: '<path d="M7 3v7a2 2 0 0 0 2 2v9M5 3v5M9 3v5M17 21V3c-2 1-3.5 3.5-3.5 7v3H17"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M11 3v3M14 3v3"/>',
  backpack: '<path d="M6 10a6 6 0 0 1 12 0v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"/><path d="M9 4.5V4a3 3 0 0 1 6 0v.5M9 14h6v3"/>',
  iron: '<path d="M3 18h17v-3a6 6 0 0 0-6-6H7"/><path d="M3 18l2.5-6H14M7 9V7a1 1 0 0 1 1-1h6"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6.3 0-4 4-6.2 3.6-11.2 3.2 2 7.4 6.3 7.4 11.2 0 3.7-2 6.3-4.5 6.3Z"/><path d="M12 21c-1.5 0-2.6-1-2.6-2.6 0-1.7 1.4-3.2 1.9-5 1.6 1.3 3.2 3 3.2 5S13.6 21 12 21Z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14H6.5A2.5 2.5 0 0 0 4 19.5Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H19v-5"/>',
  droplet: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/>',
  scissors: '<circle cx="6" cy="6" r="2.8"/><circle cx="6" cy="18" r="2.8"/><path d="M8.3 7.8 20 19M8.3 16.2 20 5"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  task: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
});
// An icon for each kind of step, guessed from its name.
const TASK_ICONS = [
  [/bath|shower|nahana|snan/, 'shower'], [/iron/, 'iron'], [/dress|ready|cloth|change|wear|uniform/, 'shirt'],
  [/breakfast|lunch|dinner|eat|food|nashta|meal|tiffin|khana/, 'utensils'], [/chai|coffee|tea/, 'coffee'],
  [/laptop|charger/, 'laptop'], [/pack|bag|admit|resume|ticket|passport|boarding|id\b|document/, 'backpack'],
  [/pooja|puja|pray|prayer|meditat/, 'flame'], [/revis|study|notes|review|read/, 'book'], [/wake|alarm/, 'alarm'],
  [/brush|freshen|water|bottle/, 'droplet'], [/groom|shave|hair|make-?up/, 'scissors'], [/cab|auto|uber|ola|rapido|book/, 'car'],
  [/dog|walk/, 'walk'], [/gift/, 'gift'], [/report|file/, 'file'], [/gym|workout|exercise|yoga|run\b/, 'dumbbell'], [/kid|drop|school/, 'cap'],
];
export const taskIcon = (name = '') => (TASK_ICONS.find(([re]) => re.test(name.toLowerCase())) || [null, 'task'])[1];

const TEMPLATE_ICON = { college: 'cap', office: 'building', gym: 'dumbbell', interview: 'briefcase', exam: 'file', flight: 'plane', train: 'train', party: 'gift', doctor: 'stetho', blank: 'pin' };
export const tripIcon = (p) => TEMPLATE_ICON[p?.templateKey] || 'pin';

export const Icon = ({ name, size = 20, cls = '' }) =>
  html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;

export const ModeIcon = ({ mode, size = 20 }) => html`<${Icon} name=${MODES[mode]?.icon || 'car'} size=${size} />`;

// ---------- Theme: 'light' | 'dark' | 'system' ----------
const THEME_KEY = 'planahead:theme';
const themeSubs = new Set();
export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}
export function setTheme(t) {
  try { t === 'system' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  themeSubs.forEach((f) => f(t));
}
export const isDark = () => {
  const t = getTheme();
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
};
export function useTheme() {
  const [t, set] = useState(getTheme());
  useEffect(() => { themeSubs.add(set); return () => themeSubs.delete(set); }, []);
  return t;
}

export const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

export function useStore() {
  const [s, set] = useState(getState());
  useEffect(() => subscribe(set), []);
  return s;
}

export function useNow(ms = 1000) {
  const [n, set] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), ms);
    const vis = () => document.visibilityState === 'visible' && set(Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [ms]);
  return n;
}

export const go = (path = '') => { location.hash = '#/' + path; };

// ---------- Toasts ----------
const toastSubs = new Set();
export const toast = (msg, kind = '') => toastSubs.forEach((f) => f({ msg, kind, id: Math.random() }));

export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const f = (t) => { setList((l) => [...l, t]); setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 4200); };
    toastSubs.add(f);
    return () => toastSubs.delete(f);
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${list.map((t) => html`<div class=${'toast ' + t.kind} key=${t.id}>${t.msg}</div>`)}</div>`;
}

// ---------- Times (monospace, small lowercase am/pm) ----------
export function splitTime(ms) {
  const s = P.fmtTime(ms);
  const m = s.match(/^(.*?)\s?([AaPp]\.?\s?[Mm]\.?)$/);
  return m ? [m[1], m[2].toLowerCase().replace(/[.\s]/g, '')] : [s, ''];
}
export const hm = (ms) => splitTime(ms)[0];
export function TimeText({ ms, cls = '', ap = true }) {
  const [t, a] = splitTime(ms);
  return html`<span class=${'tt ' + cls}>${t}${ap && a ? html`<small>${a}</small>` : ''}</span>`;
}

// ---------- Bottom sheet ----------
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.classList.add('lock');
    return () => { document.removeEventListener('keydown', k); document.body.classList.remove('lock'); };
  }, []);
  return html`<div class="sheet-wrap" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-head"><b>${title}</b><button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button></div>
      ${children}
    </div>
  </div>`;
}

// ---------- Place search (India) ----------

// A tappable place row; opens a search sheet. kind 'from' draws a ring marker, 'to' a square.
export function PlaceField({ label, value, onChange, near, quick = [], placeholder, autoFocus, kind = 'to', allowCurrent = true, compact = false, sub }) {
  const [open, setOpen] = useState(!value && autoFocus);
  const [locating, setLocating] = useState(false);

  const useHere = async () => {
    setOpen(false); setLocating(true);
    try {
      const pos = await currentPosition();
      const g = await reverseGeocode(pos.lat, pos.lng);
      onChange({ id: 'current', name: 'Current location', address: g.address, ...pos, isCurrent: true });
    } catch (e) { toast(e.message, 'warn'); } finally { setLocating(false); }
  };
  const sheet = open ? html`<${Sheet} title=${label} onClose=${() => setOpen(false)}>
      <${PlaceSearch} near=${near} quick=${quick} allowCurrent=${allowCurrent} onHere=${useHere}
        onPick=${(p) => { setOpen(false); onChange(p); }} placeholder=${compact ? 'Search your area, society or street' : placeholder} />
    </${Sheet}>` : '';
  if (compact) return html`<button type="button" class="btn sm" onClick=${() => setOpen(true)}>${locating ? 'Finding…' : placeholder}</button>${sheet}`;

  return html`<button type="button" class=${'place ' + kind + (value ? '' : ' unset')} onClick=${() => setOpen(true)} aria-label=${label + (value ? ': ' + value.name : '')}>
      <span class="place-mark" aria-hidden="true"></span>
      <span class="place-body">
        ${value
          ? html`<span class="place-name">${sub ? html`<span class="muted">${sub} · </span>` : ''}${value.name}</span>${value.address ? html`<span class="place-addr">${value.address}</span>` : ''}`
          : html`<span class="place-ph">${locating ? 'Finding you…' : placeholder}</span>`}
      </span>
    </button>
    ${sheet}`;
}

function PlaceSearch({ near, quick, allowCurrent, onHere, onPick, placeholder }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef();
  useEffect(() => { setTimeout(() => input.current?.focus(), 60); }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes([]); setBusy(false); setErr(''); return; }
    const ac = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      searchPlaces(term, near, ac.signal)
        .then((r) => { setRes(r); setErr(r.length ? '' : 'No places found. Try adding the area or city, e.g. “Sector 18 Noida”.'); })
        .catch((e) => { if (e.name !== 'AbortError') setErr('Search is unavailable right now. Check your internet connection.'); })
        .finally(() => !ac.signal.aborted && setBusy(false));
    }, 220);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q]);

  const typing = q.trim().length >= 2;
  return html`<div class="search">
    <label class="search-box"><${Icon} name="search" size=${18} />
      <input ref=${input} value=${q} placeholder=${placeholder} autocomplete="off" enterkeyhint="search" onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && res[0]) onPick(res[0]); }} aria-label="Search places in India" />
      ${busy ? html`<span class="spinner"></span>` : q ? html`<button type="button" class="icon-btn sm" onClick=${() => setQ('')} aria-label="Clear"><${Icon} name="x" size=${16} /></button>` : ''}
    </label>
    <ul class="list">
      ${!typing && allowCurrent ? html`<li><button type="button" class="row-btn" onClick=${onHere}><span class="row-ic"><${Icon} name="locate" size=${18} /></span><span class="row-body"><b>Use current location</b><small>Uses your phone's GPS</small></span></button></li>` : ''}
      ${(typing ? res : quick).map((it) => html`<li key=${it.id + it.name}><button type="button" class="row-btn" onClick=${() => onPick(it)}>
        <span class="row-ic"><${Icon} name=${it.icon || 'pin'} size=${18} /></span>
        <span class="row-body"><b>${it.label || it.name}</b>${it.address ? html`<small>${it.address}</small>` : ''}</span></button></li>`)}
      ${err ? html`<li class="list-empty">${err}</li>` : ''}
      ${!typing && !quick.length ? html`<li class="list-empty">Search any place in India: a college, office, metro station, airport or address.</li>` : ''}
    </ul>
  </div>`;
}

// ---------- Metro station picker ----------

export function StationSheet({ title, cityId, near, onPick, onCity, onClose }) {
  const [city, setCity] = useState(null);
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => { M.getCity(cityId).then(setCity); M.cities().then(setList); }, [cityId]);
  const all = useMemo(() => (city ? city.stations.map((_, i) => M.station(city, i)).sort((a, b) => a.name.localeCompare(b.name)) : []), [city]);
  const nearest = useMemo(() => (city && near ? M.nearestStations(city, near, 3) : []), [city, near]);
  const shown = q.trim() ? all.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())) : all;
  const row = (s, extra) => html`<li key=${s.i + (extra || '')}><button type="button" class="row-btn" onClick=${() => onPick(s.i)}>
    <span class="dots">${s.lines.slice(0, 3).map((l) => html`<i style=${{ background: l.colour }} title=${l.name}></i>`)}</span>
    <span class="row-body"><b>${s.name}</b><small>${s.lines.map((l) => l.name).join(' · ')}${s.dist != null ? ` · ${s.dist < 1 ? Math.round(s.dist * 1000) + ' m' : s.dist.toFixed(1) + ' km'} away` : ''}</small></span></button></li>`;
  return html`<${Sheet} title=${title} onClose=${onClose}>
    <div class="search">
      <label class="select"><span>Metro</span>
        <select value=${cityId} onChange=${(e) => onCity(e.target.value)} aria-label="Metro city">
          ${list.map((c) => html`<option value=${c.id}>${c.name} · ${c.system}</option>`)}
        </select><${Icon} name="down" size=${16} /></label>
      <label class="search-box"><${Icon} name="search" size=${18} /><input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Search station" aria-label="Search station" /></label>
      <ul class="list">
        ${!q.trim() && nearest.length ? html`<li class="list-head">Nearest</li>${nearest.map((s) => row(s, 'n'))}<li class="list-head">All stations</li>` : ''}
        ${shown.map((s) => row(s))}
        ${!shown.length ? html`<li class="list-empty">No station matches “${q}”.</li>` : ''}
      </ul>
    </div>
  </${Sheet}>`;
}

// ---------- Journey pieces ----------

const WALKISH = ['walk'];
// Colour for a stretch of the journey: metro segments use their line colour.
export function journeyParts(travel) {
  if (!travel?.legs?.length) return [];
  const parts = [];
  travel.legs.forEach((l) => {
    if (l.mode === 'metro' && l.segments?.length) {
      const segMins = l.segments.reduce((a, s) => a + (s.mins || 0), 0) || 1;
      const extra = l.mins - segMins;
      l.segments.forEach((s, i) => parts.push({ kind: 'line', colour: s.colour, mins: (s.mins || 0) + (i === 0 ? extra : 0) }));
    } else parts.push({ kind: WALKISH.includes(l.mode) ? 'walk' : l.mode === 'metro' || l.mode === 'bus' ? 'line' : 'road', colour: l.mode === 'bus' ? 'var(--good)' : null, mins: l.mins });
  });
  return parts;
}

export function JourneyBar({ travel, thin = false }) {
  const parts = journeyParts(travel);
  if (!parts.length) return '';
  return html`<div class=${'jbar ' + (thin ? 'thin' : '')} aria-hidden="true">${parts.map((p, i) => html`<i key=${i} class=${'jb-' + p.kind} style=${{ flex: Math.max(1, p.mins), ...(p.colour ? { background: p.colour } : {}) }}></i>`)}</div>`;
}

export function legShort(travel) {
  if (!travel?.legs?.length) return '';
  if (travel.legs.length === 1) return `${MODES[travel.legs[0].mode]?.label || 'Go'} · ${P.fmtDur(travel.legs[0].mins)} · ${travel.legs[0].detail || ''}`;
  return travel.legs.map((l) => (l.mode === 'metro' ? `Train ${P.fmtDur(l.mins)}` : `${MODES[l.mode]?.label || 'Go'} ${l.mins}`)).join(' · ');
}

export function MetroSegments({ segments }) {
  if (!segments?.length) return '';
  return html`<div class="segs">${segments.map((s, i) => html`<div class="seg-row" key=${i}>
    <span class="line-chip" style=${{ background: s.colour, color: lineInk(s.colour) }}>${s.line.replace(/ Line$/, '')}</span>
    <span class="seg-txt">${s.stops} stop${s.stops > 1 ? 's' : ''} · ${s.from} → ${s.to}</span>
  </div>`)}</div>`;
}

// Dark text on light line colours (Yellow, Aqua), white on the rest.
export function lineInk(hex = '#666') {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1A1A1A' : '#FFFFFF';
}

// `after(leg, i)` can add something under a leg, e.g. the walk/auto choice for reaching a station.
export function LegList({ travel, compact = false, after = null }) {
  if (!travel?.legs?.length) return '';
  return html`<ol class=${'legs ' + (compact ? 'compact' : '')}>${travel.legs.map((l, i) => html`<li key=${i}>
    <span class="leg-ic"><${ModeIcon} mode=${l.mode} size=${16} /></span>
    <span class="leg-body"><b>${l.title}</b>${l.detail && !compact ? html`<small>${l.detail}</small>` : ''}${!compact && l.segments ? html`<${MetroSegments} segments=${l.segments} />` : ''}${after ? after(l, i) : ''}</span>
    <span class="leg-mins mono">${P.fmtDur(l.mins)}</span>
  </li>`)}</ol>`;
}

// ---------- Day timeline (planner + live) ----------

export function Timeline({ plan, tl, travel, done = {}, now = Date.now(), live = false }) {
  const firstOpen = tl.steps.findIndex((s) => s.kind === 'task' && !done[s.id]);
  return html`<ol class="tline">
    ${tl.steps.map((s, i) => {
      const t = html`<span class="tl-t mono">${hm(s.at)}</span>`;
      const state = live && s.kind === 'task' ? (done[s.id] ? 'done' : i === firstOpen ? 'now' : '') : '';
      if (s.kind === 'task') return html`<li class=${'tl-row ' + state} key=${s.id}>${t}<span class="tl-name with-ic"><${Icon} name=${taskIcon(s.name)} size=${17} />${s.name}</span><span class="tl-dur mono">${s.mins} min</span></li>`;
      if (s.kind === 'leave') {
        return html`<li class="tl-row leave" key="leave">${t}<span class="tl-name"><b>Leave${plan.from && !plan.from.isCurrent ? ` ${plan.from.name}` : ''}</b>
          ${travel ? html`<small>${MODES[plan.mode].label} · ${P.fmtDur(tl.travelMins)}</small><${JourneyBar} travel=${travel} thin=${true} />` : html`<small>Add where you're going to include travel</small>`}</span></li>`;
      }
      if (s.kind === 'arrive') return html`<li class="tl-row arrive" key="arrive">${t}<span class="tl-name">Reach ${plan.to?.name || ''}</span>${tl.earlyMins > 0 ? html`<span class="tl-dur good">${tl.earlyMins} min early</span>` : ''}</li>`;
      return html`<li class="tl-row event" key="event">${t}<span class="tl-name"><b>${plan.title || 'Your trip'}</b></span></li>`;
    })}
  </ol>`;
}
