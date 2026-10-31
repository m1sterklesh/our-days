/**
 * sw.js — service worker: принимает push-уведомления и открывает календарь по нажатию.
 * Ничего не кеширует — сайт всегда грузится свежим.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Пришло напоминание с сервера
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Our Days';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || './' },
  }));
});

// Нажали на уведомление — открываем календарь (или переключаемся на уже открытый)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || './', self.registration.scope).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
