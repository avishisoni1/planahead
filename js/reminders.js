// Smart reminders: in-app/OS notifications while the app is open, plus a calendar file
// with alarms so reminders fire even when the app is closed.
import { MIN, fmtTime, fmtDur } from './plan.js';

let timers = [];

export const notifySupported = () => 'Notification' in window;

export async function ensurePermission() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return 'denied'; }
  }
  return Notification.permission;
}

export async function notify(title, body, tag = 'planahead') {
  chime();
  if (!notifySupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { body, tag, icon: 'icon.svg', badge: 'icon.svg', renotify: true, vibrate: [180, 80, 180] });
    new Notification(title, { body, tag });
  } catch { /* some browsers only allow SW notifications */ }
}

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i ? 880 : 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32);
    });
  } catch { /* audio blocked */ }
}

export function reminderList(plan, tl) {
  const out = [];
  tl.steps.forEach((s, i) => {
    if (s.kind === 'task') {
      const next = tl.steps[i + 1];
      out.push({ at: s.at, title: `${s.emoji || '⏰'} Time to: ${s.name}`, body: `${fmtDur(s.mins)} · then ${next.kind === 'leave' ? `leave at ${fmtTime(next.at)}` : next.name}`, tag: `task-${s.id}` });
    }
  });
  out.push({ at: tl.leave - 5 * MIN, title: '🚪 Leave in 5 minutes', body: `Head out by ${fmtTime(tl.leave)} for ${plan.title || 'your plan'}`, tag: 'leave-soon' });
  out.push({ at: tl.leave, title: `🚪 Leave now — ${plan.title || 'your plan'}`, body: `Arrive ~${fmtTime(tl.arrive)} · starts ${fmtTime(tl.event)}`, tag: 'leave' });
  return out;
}

// Adds this plan's reminders; call clearScheduled() first when rescheduling everything.
export function schedule(plan, tl) {
  const now = Date.now();
  reminderList(plan, tl).forEach((r) => {
    if (r.tag.startsWith('task-') && plan.done?.[r.tag.slice(5)]) return;
    const d = r.at - now;
    if (d > 0 && d < 2 ** 31 - 1) timers.push(setTimeout(() => notify(r.title, r.body, r.tag), d));
  });
}

export function clearScheduled() {
  timers.forEach(clearTimeout);
  timers = [];
}

// ---------- Calendar export (.ics with VALARMs) ----------

const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);

export function downloadICS(plan, tl) {
  const stamp = icsDate(Date.now());
  const ev = (uid, start, end, summary, desc, alarms = [0], location = '') => [
    'BEGIN:VEVENT', `UID:${uid}@planahead`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(Math.max(end, start + MIN))}`,
    `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(desc)}`, location && `LOCATION:${esc(location)}`,
    ...alarms.flatMap((m) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:${m ? `-PT${m}M` : 'PT0M'}`, 'END:VALARM']),
    'END:VEVENT',
  ].filter(Boolean);
  const title = plan.title || 'Plan';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PlanAhead//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  tl.steps.filter((s) => s.kind === 'task').forEach((s) =>
    lines.push(...ev(`${plan.id}-${s.id}`, s.at, s.end, `${s.emoji || '⏰'} ${s.name}`, `${fmtDur(s.mins)} · ${title}`)));
  const to = plan.to ? `${plan.to.name}${plan.to.address ? ', ' + plan.to.address : ''}` : '';
  lines.push(...ev(`${plan.id}-leave`, tl.leave, tl.arrive, `🚪 Leave for ${title}`, `Arrive ~${fmtTime(tl.arrive)}`, [5, 0], to));
  lines.push(...ev(`${plan.id}-event`, tl.event, tl.event + 60 * MIN, `${plan.emoji || '📍'} ${title}`, 'Planned with PlanAhead', [], to));
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${title.replace(/[^\w ]+/g, '').trim() || 'plan'}.ics` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
