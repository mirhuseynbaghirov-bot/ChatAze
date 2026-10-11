/* ChatAze — telefona bildiriş (push) qəbul edən service worker */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  const n = d.data || d.notification || d;
  e.waitUntil(self.registration.showNotification(n.title || 'ChatAze', {
    body: n.body || 'Yeni mesaj',
    icon: '/mark.png',
    badge: '/mark.png',
    tag: n.tag || 'chataze',
    renotify: true,
    data: { url: n.url || '/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
