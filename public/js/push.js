/**
 * push.js
 * Client side of Pack & Wear Just-in-Time Alarms: registers the service worker,
 * asks for notification permission (on a button click, as browsers require),
 * subscribes via the Push API and stores the subscription on the server.
 */
(function () {
  const panel = document.getElementById('pushAlarms');
  if (!panel) return;

  const vapidKey = panel.dataset.vapidKey;
  const enableBtn = document.getElementById('pushEnableBtn');
  const testBtn = document.getElementById('pushTestBtn');
  const statusEl = document.getElementById('pushStatus');
  const defaultHint = statusEl.textContent;

  const setStatus = (text) => { statusEl.textContent = text; };
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (!supported || !vapidKey) {
    enableBtn.disabled = true;
    setStatus(supported
      ? 'Push alarms are not configured on this server.'
      : 'This browser does not support push notifications.');
    return;
  }

  /** VAPID public key (base64url) -> Uint8Array for applicationServerKey */
  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.data = data; // keep statusCode / resubscribe / detail from the server
      throw err;
    }
    return data;
  }

  let registration = null;
  const serverKey = urlBase64ToUint8Array(vapidKey);

  /** True when the subscription was created with this server's current VAPID public key. */
  function keyMatches(subscription) {
    const key = subscription && subscription.options && subscription.options.applicationServerKey;
    if (!key) return true; // browser doesn't expose it; let the server decide
    const bytes = new Uint8Array(key);
    return bytes.length === serverKey.length && bytes.every((b, i) => b === serverKey[i]);
  }

  /** Drops any existing subscription and creates a fresh one with the current key, then saves it. */
  async function resubscribe() {
    const old = await registration.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const fresh = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
    await postJson('/push/subscribe', { subscription: fresh.toJSON() });
    return fresh;
  }

  function render(subscribed) {
    enableBtn.disabled = false;
    enableBtn.dataset.state = subscribed ? 'on' : 'off';
    enableBtn.setAttribute('aria-pressed', String(subscribed));
    enableBtn.querySelector('span').textContent = subscribed ? 'Turn off' : 'Enable';
    testBtn.hidden = !subscribed;
    if (Notification.permission === 'denied') {
      setStatus('Notifications are blocked for this site. Allow them in your browser settings to use alarms.');
    } else {
      setStatus(subscribed ? 'On: you’ll get a notification when rain starts or temperatures drop in your saved cities.' : defaultHint);
    }
  }

  async function enable() {
    enableBtn.disabled = true;
    setStatus('Asking for permission…');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      render(false);
      if (permission === 'default') setStatus('Permission wasn’t granted. Tap Enable to try again.');
      return;
    }
    setStatus('Subscribing…');
    const existing = await registration.pushManager.getSubscription();
    if (existing && keyMatches(existing)) {
      await postJson('/push/subscribe', { subscription: existing.toJSON() });
    } else {
      // No subscription, or one left over from a different VAPID key (e.g. another app on this origin)
      await resubscribe();
    }
    render(true);
  }

  async function disable() {
    enableBtn.disabled = true;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const { endpoint } = subscription;
      await subscription.unsubscribe();
      await postJson('/push/unsubscribe', { endpoint });
    }
    render(false);
  }

  enableBtn.addEventListener('click', async () => {
    try {
      if (enableBtn.dataset.state === 'on') await disable();
      else await enable();
    } catch (err) {
      console.warn('[push]', err);
      enableBtn.disabled = false;
      setStatus(`Couldn’t update alarms: ${err.message}`);
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    const sent = 'Test notification sent. It should appear in a few seconds.';
    try {
      await postJson('/push/test');
      setStatus(sent);
    } catch (err) {
      const info = err.data || {};
      console.warn('[push] test failed', info);
      if (info.resubscribe && Notification.permission === 'granted') {
        // The push service rejected this subscription (stale, or made with another key):
        // replace it and retry once.
        try {
          setStatus('Refreshing this browser’s subscription…');
          await resubscribe();
          await postJson('/push/test');
          setStatus(`${sent} (Your old subscription was stale and has been replaced.)`);
        } catch (retryErr) {
          const r = retryErr.data || {};
          render(false);
          setStatus(`Test failed: ${retryErr.message}${r.detail ? ` [${r.detail}]` : ''}`);
        }
      } else {
        setStatus(`Test failed: ${err.message}${info.detail ? ` [${info.detail}]` : ''}`);
      }
    } finally {
      testBtn.disabled = false;
    }
  });

  navigator.serviceWorker.register('/sw.js')
    .then(async (reg) => {
      registration = reg;
      let subscription = await reg.pushManager.getSubscription();
      if (subscription && Notification.permission === 'granted') {
        if (!keyMatches(subscription)) {
          // Left over from a different VAPID key: it can never receive our pushes, so replace it
          subscription = await resubscribe().catch((e) => { console.warn('[push] resubscribe failed', e); return null; });
        } else {
          // Keep the server in sync (e.g. after a DB reset or a server-side cleanup)
          postJson('/push/subscribe', { subscription: subscription.toJSON() }).catch(() => {});
        }
      }
      render(Boolean(subscription) && Notification.permission === 'granted');
    })
    .catch((err) => {
      console.warn('[push] service worker registration failed:', err);
      enableBtn.disabled = true;
      setStatus('Push alarms need a secure connection (HTTPS or localhost).');
    });
})();
