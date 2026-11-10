/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

// Seule l'interface est mise en cache ; les données passent toujours par le PC.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; opId?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'VoxControl', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'VoxControl', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.opId ?? 'vox',
      data: { opId: data.opId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const opId = event.notification.data?.opId as string | undefined;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = all[0] as WindowClient | undefined;
      if (client) {
        await client.focus();
        if (opId) client.postMessage({ type: 'open-op', opId });
        return;
      }
      await self.clients.openWindow(opId ? `/?op=${encodeURIComponent(opId)}` : '/');
    })(),
  );
});
