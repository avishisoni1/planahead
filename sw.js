// Offline shell + notification clicks. Network-first so deploys show up immediately.
const CACHE = 'planahead-v11';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/ui.js', 'js/plan.js', 'js/providers.js', 'js/metro.js', 'js/ai.js', 'js/store.js', 'js/reminders.js', 'data/metro.json', 'icon.svg', 'manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isShell = url.origin === location.origin ? !url.pathname.includes('/api/') : SHELL.includes(url.href);
  if (!isShell) return; // live data (routing, search) always goes to the network
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list[0];
    return c ? c.focus() : self.clients.openWindow('./');
  }));
});
