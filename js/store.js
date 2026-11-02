// Local-first state: no sign-up, everything lives on the device.
const KEY = 'planahead:v1';

const DEFAULTS = {
  places: { home: null, work: null },
  recents: [],      // recently used destinations
  routines: [],     // saved recurring plans { id, title, emoji, time:'HH:MM', days:[0-6], from, to, mode, buffer, tasks }
  plans: [],        // upcoming one-off plans
  active: null,     // { plan, travel, startedAt, done: {taskId: ms}, arrivedAt }
  learn: {},        // per-task actual durations { [name]: { avg, n } }
  travelLearn: {},  // per route/mode/hour: actual ÷ predicted travel { [key]: { r, n } }
  history: [],      // finished plans { id, title, eventAt, onTime, lateMins }
  settings: { defaultBuffer: null },
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw ? { ...structuredClone(DEFAULTS), ...raw } : structuredClone(DEFAULTS);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = load();
const listeners = new Set();

export const getState = () => state;

export function update(fn) {
  fn(state);
  state = { ...state };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  listeners.forEach((l) => l(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function rememberPlace(place) {
  if (!place || place.isCurrent) return;
  update((s) => {
    s.recents = [place, ...s.recents.filter((p) => p.id !== place.id && p.name !== place.name)].slice(0, 6);
  });
}

const norm = (name) => name.trim().toLowerCase();

// Exponential moving average of how long a task really takes (P2: behaviour learning).
export function learnTask(name, actualMins) {
  if (!name || actualMins < 1 || actualMins > 240) return;
  update((s) => {
    const k = norm(name), prev = s.learn[k];
    s.learn[k] = prev ? { avg: prev.avg * 0.6 + actualMins * 0.4, n: prev.n + 1 } : { avg: actualMins, n: 1 };
  });
}

export const learnedFor = (name) => state.learn[norm(name || '')];

// How much longer (or shorter) this person's real trips take than predicted, per route, mode and hour.
// Stored as a moving average of actual ÷ predicted; only used once it's clearly different from 1.
export function learnTravel(key, actualMins, predictedMins) {
  if (!key || predictedMins < 3) return;
  const ratio = actualMins / predictedMins;
  if (ratio < 0.5 || ratio > 2.5) return; // forgot to tap "I've left" / "I've reached"
  update((s) => {
    s.travelLearn ||= {};
    const prev = s.travelLearn[key];
    s.travelLearn[key] = prev ? { r: prev.r * 0.6 + ratio * 0.4, n: prev.n + 1 } : { r: ratio, n: 1 };
  });
}
export function travelFactor(key) {
  const t = state.travelLearn?.[key];
  if (!t || Math.abs(t.r - 1) < 0.05) return null;
  return { factor: Math.min(1.5, Math.max(0.8, t.r)), n: t.n };
}

export function resetAll() {
  localStorage.removeItem(KEY);
  state = structuredClone(DEFAULTS);
  listeners.forEach((l) => l(state));
}
