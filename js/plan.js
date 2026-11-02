// Timeline math, templates and time formatting. Pure functions, no DOM.

export const MIN = 60000;

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

const task = (name, mins, emoji = '') => ({ id: uid(), name, mins, emoji });

// Calendar event colours. Each trip carries one, like an event on a calendar.
export const COLORS = {
  peacock: '#039BE5', blueberry: '#3F51B5', lavender: '#7986CB', grape: '#8E24AA', flamingo: '#E67C73',
  tomato: '#D50000', tangerine: '#F4511E', banana: '#F6BF26', sage: '#33B679', basil: '#0B8043', graphite: '#616161',
};
const TEMPLATE_COLOR = { college: 'peacock', office: 'blueberry', gym: 'sage', interview: 'grape', exam: 'tomato', flight: 'lavender', train: 'basil', party: 'flamingo', doctor: 'tangerine', blank: 'peacock' };
export const colorOf = (p) => COLORS[p?.color] || COLORS[TEMPLATE_COLOR[p?.templateKey]] || COLORS.peacock;
export const templateColor = (key) => TEMPLATE_COLOR[key] || 'peacock';

// "daily" templates suggest saving as a repeating trip; "occasional" ones are one-offs.
export const TEMPLATES = [
  { key: 'college', kind: 'daily', emoji: '🎓', title: 'College', mode: 'metro', buffer: 10, hour: 9,
    tasks: () => [task('Wake up & freshen up', 15, '🪥'), task('Bath', 15, '🚿'), task('Breakfast', 15, '🍳'), task('Pack bag', 5, '🎒')] },
  { key: 'office', kind: 'daily', emoji: '🏢', title: 'Office', mode: 'metro', buffer: 10, hour: 10,
    tasks: () => [task('Get ready', 30, '👕'), task('Breakfast', 15, '☕'), task('Pack laptop & charger', 5, '💻')] },
  { key: 'gym', kind: 'daily', emoji: '🏋️', title: 'Gym', mode: 'bike', buffer: 5, hour: 7,
    tasks: () => [task('Change', 10, '👟'), task('Fill water bottle', 2, '💧')] },
  { key: 'interview', kind: 'occasional', emoji: '💼', title: 'Job interview', mode: 'cab', buffer: 20, hour: 11,
    tasks: () => [task('Bath', 20, '🚿'), task('Dress up', 20, '👔'), task('Review notes', 20, '📒'), task('Eat something', 15, '🥪'), task('Pack resume & ID', 5, '📄')] },
  { key: 'exam', kind: 'occasional', emoji: '📝', title: 'Exam', mode: 'cab', buffer: 30, hour: 10,
    tasks: () => [task('Quick revision', 30, '📚'), task('Get ready', 25, '👕'), task('Eat', 15, '🍳'), task('Pack admit card & pens', 5, '🖊️')] },
  { key: 'flight', kind: 'occasional', emoji: '✈️', title: 'Flight', mode: 'cab', buffer: 120, hour: 14,
    tasks: () => [task('Final packing', 30, '🧳'), task('Get ready', 30, '👕'), task('Check ID & boarding pass', 10, '🛂')] },
  { key: 'train', kind: 'occasional', emoji: '🚆', title: 'Train', mode: 'cab', buffer: 30, hour: 18,
    tasks: () => [task('Final packing', 25, '🧳'), task('Get ready', 20, '👕'), task('Pack food & water', 10, '🍱')] },
  { key: 'party', kind: 'occasional', emoji: '🎉', title: 'Wedding / party', mode: 'cab', buffer: 10, hour: 20,
    tasks: () => [task('Bath', 15, '🚿'), task('Get dressed', 30, '👗'), task('Pack gift', 5, '🎁')] },
  { key: 'doctor', kind: 'occasional', emoji: '🩺', title: 'Doctor visit', mode: 'auto', buffer: 15, hour: 17,
    tasks: () => [task('Get ready', 20, '👕'), task('Collect reports', 5, '🗂️')] },
  { key: 'blank', kind: 'occasional', emoji: '📍', title: '', mode: 'cab', buffer: 10, hour: null, tasks: () => [task('Get ready', 20, '👕')] },
];

export const SUGGESTIONS = [
  ['Bath', 15, '🚿'], ['Get dressed', 15, '👕'], ['Eat', 20, '🍳'], ['Chai / coffee', 10, '☕'], ['Pack bag', 5, '🎒'],
  ['Iron clothes', 10, '🧺'], ['Pooja', 10, '🪔'], ['Book cab', 5, '🚕'], ['Drop kids', 20, '🎒'], ['Grooming', 15, '💈'],
];

// The usual order of a morning: wake → bath → get dressed → eat → pack → book a ride.
// New steps are slotted into this order instead of being added at the end.
const ORDER = [
  [/wake|alarm|freshen|brush/, 0], [/exercise|yoga|walk the dog|run\b/, 5], [/bath|shower|nahana/, 10], [/shave|groom|hair/, 14],
  [/iron/, 16], [/dress|get ready|change|clothes|wear/, 20], [/make-?up/, 22], [/pooja|puja|prayer|meditat/, 25],
  [/breakfast|lunch|dinner|eat|food|chai|coffee|tea|meal/, 30], [/revis|review|notes|study|prepare/, 34],
  [/pack|bag|charger|laptop|id\b|ticket|document|admit|bottle|gift|resume|report/, 40], [/drop|kids/, 44], [/book|cab|auto|uber|ola|rapido/, 50],
];
export const orderRank = (name) => {
  const n = (name || '').toLowerCase();
  const hit = ORDER.find(([re]) => re.test(n));
  return hit ? hit[1] : 38;
};
export function insertInOrder(tasks, t) {
  const r = orderRank(t.name);
  const i = tasks.findIndex((x) => orderRank(x.name) > r);
  return i < 0 ? [...tasks, t] : [...tasks.slice(0, i), t, ...tasks.slice(i)];
}

export function defaultEventTime(hour) {
  const d = new Date();
  if (hour != null) {
    d.setHours(hour, 0, 0, 0);
    if (d.getTime() - Date.now() < 90 * MIN) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 2);
  return d.getTime();
}

export function newPlanFrom(tpl, extra = {}) {
  return {
    id: uid(), title: tpl.title, emoji: tpl.emoji, eventAt: defaultEventTime(tpl.hour),
    from: null, to: null, mode: tpl.mode, buffer: tpl.buffer, tasks: tpl.tasks(), templateKey: tpl.key, color: templateColor(tpl.key),
    ...extra,
  };
}

// Works backwards from the event: event - buffer = target arrival, minus travel = leave, minus prep = start.
// Transit returns a schedule-aware departAt/arriveAt, which wins over the simple subtraction.
export function buildTimeline(plan, travel) {
  const event = plan.eventAt;
  const target = event - plan.buffer * MIN;
  let leave, arrive;
  if (travel?.departAt && travel?.arriveAt && travel.arriveAt <= target + MIN) {
    leave = travel.departAt; arrive = travel.arriveAt;
  } else if (travel) {
    arrive = target; leave = target - Math.round(travel.mins) * MIN;
  } else {
    arrive = target; leave = target;
  }
  const tasks = plan.tasks.filter((t) => t.mins > 0);
  const prepMins = tasks.reduce((s, t) => s + t.mins, 0);
  const start = leave - prepMins * MIN;
  let at = start;
  const steps = tasks.map((t) => {
    const s = { kind: 'task', id: t.id, name: t.name, emoji: t.emoji, mins: t.mins, at, end: at + t.mins * MIN };
    at = s.end;
    return s;
  });
  steps.push({ kind: 'leave', id: 'leave', at: leave, end: arrive });
  steps.push({ kind: 'arrive', id: 'arrive', at: arrive });
  steps.push({ kind: 'event', id: 'event', at: event });
  return { start, leave, arrive, event, steps, prepMins, travelMins: (arrive - leave) / MIN, earlyMins: Math.round((event - arrive) / MIN) };
}

// Always 12-hour ("6:53 am"), whatever the phone's language or region settings say.
export const fmtTime = (ms) => {
  const d = new Date(ms), h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

export function fmtDur(mins) {
  mins = Math.round(mins);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtRel(ms, now = Date.now()) {
  const diff = Math.round((ms - now) / MIN);
  if (Math.abs(diff) < 1) return 'now';
  return diff > 0 ? `in ${fmtDur(diff)}` : `${fmtDur(-diff)} ago`;
}

export function fmtClock(secs) {
  secs = Math.max(0, Math.round(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtDay(ms) {
  const d = new Date(ms), today = new Date();
  const dayDiff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 864e5);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  if (dayDiff === -1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// The next occurrence of a routine's HH:MM on one of its weekdays (today counts if still ahead).
export function nextOccurrence(routine, from = Date.now()) {
  const [h, m] = routine.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (routine.days.includes(d.getDay()) && d.getTime() > from) return d.getTime();
  }
  return null;
}

export const toHHMM = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
