/**
 * sw.js — Smart Weather service worker
 * Receives Pack & Wear Web Push alarms and shows them as browser notifications.
 * Clicking a notification focuses (or opens) the app on the alarm's city.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Smart Weather';
  const options = {
    body: data.body || 'The weather is about to change.',
    tag: data.tag || 'smart-weather-alarm',
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Only ever navigate within this app's own origin
  let target = new URL('/', self.location.origin);
  try {
    const candidate = new URL(event.notification.data && event.notification.data.url, self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  } catch (e) { /* keep "/" */ }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(target.href);
        return undefined;
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

// The browser rotated the subscription: re-subscribe and tell the server
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription && event.oldSubscription.options;
    if (!options || !options.applicationServerKey) return;
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: options.applicationServerKey,
    });
    await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
  })());
});
