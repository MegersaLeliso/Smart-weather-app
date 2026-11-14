/**
 * services/push.js
 * Thin wrapper around the `web-push` library for Pack & Wear alarms.
 * - Loads web-push lazily with import() (it's an ES module; this keeps the
 *   CommonJS app working on any supported Node version).
 * - Validates browser subscriptions and only accepts endpoints on the real
 *   browser push services, so the server can't be pointed at arbitrary URLs.
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || '';

// Hostnames used by Chrome/Edge/Brave/Opera (FCM), Firefox (Mozilla autopush),
// Edge on Windows (WNS) and Safari (Apple Push).
const ALLOWED_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

function isConfigured() {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY && SUBJECT);
}

let webpushPromise = null;
function getWebPush() {
  if (!webpushPromise) {
    webpushPromise = import('web-push').then((webpush) => {
      webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
      return webpush;
    });
  }
  return webpushPromise;
}

function isAllowedEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch (e) {
    return false;
  }
}

/** Returns a clean subscription object, or null if the input isn't a valid one. */
function validateSubscription(input) {
  if (!input || typeof input !== 'object') return null;
  const { endpoint, keys, expirationTime } = input;
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !isAllowedEndpoint(endpoint)) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  const b64url = /^[A-Za-z0-9_-]+=*$/;
  if (!b64url.test(keys.p256dh) || !b64url.test(keys.auth) || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return {
    endpoint,
    expirationTime: typeof expirationTime === 'number' ? expirationTime : null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

/** Human-readable explanation of a push-service HTTP status. */
function explainStatus(statusCode) {
  switch (statusCode) {
    case 400: return 'The push service rejected the request as malformed.';
    case 401:
    case 403: return 'The push service rejected the VAPID credentials. This subscription was created with a different key, so it must be replaced.';
    case 404:
    case 410: return 'This browser subscription has expired or was unsubscribed.';
    case 413: return 'The notification payload is too large.';
    case 429: return 'The push service is rate-limiting requests; try again later.';
    default: return statusCode >= 500 ? 'The push service is temporarily unavailable.' : 'Unexpected response from the push service.';
  }
}

/**
 * Sends one notification.
 * @returns {Promise<{ok: boolean, gone: boolean, resubscribe: boolean, statusCode?: number, error?: string, detail?: string}>}
 *   `gone`        = the subscription no longer exists (404/410) — delete it.
 *   `resubscribe` = the subscription can't be used with our keys (401/403/404/410) — the browser must create a new one.
 */
async function sendPush(subscription, payload) {
  if (!isConfigured()) return { ok: false, gone: false, resubscribe: false, error: 'Web Push is not configured (VAPID keys missing)' };
  if (!validateSubscription(subscription)) return { ok: false, gone: true, resubscribe: true, error: 'Invalid subscription' };
  const webpush = await getWebPush();
  const host = (() => { try { return new URL(subscription.endpoint).hostname; } catch (e) { return '?'; } })();
  try {
    const res = await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60, urgency: 'high' });
    return { ok: true, gone: false, resubscribe: false, statusCode: res.statusCode };
  } catch (err) {
    const statusCode = err && err.statusCode;
    // The push service's own response body is the most useful diagnostic (e.g. FCM's
    // "the key in the authorization header does not correspond to the sender ID...")
    const detail = err && err.body ? String(err.body).trim().slice(0, 300) : '';
    console.error(`[PUSH] send to ${host} failed: HTTP ${statusCode || 'n/a'} ${err.message}${detail ? ` | response: ${detail}` : ''}`);
    return {
      ok: false,
      gone: statusCode === 404 || statusCode === 410,
      resubscribe: [401, 403, 404, 410].includes(statusCode),
      statusCode,
      error: `${explainStatus(statusCode)} (HTTP ${statusCode || 'n/a'})`,
      detail,
    };
  }
}

module.exports = { isConfigured, validateSubscription, isAllowedEndpoint, sendPush, PUBLIC_KEY };
