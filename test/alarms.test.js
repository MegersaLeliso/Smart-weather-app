/**
 * Tests for the Pack & Wear alarm job and push helpers.
 * Run with: npm test
 * Uses injected fakes — no database, network, or real push service involved.
 */
const test = require('node:test');
const assert = require('node:assert');

const { runAlarmCheck, buildMessage, clockLabel } = require('../jobs/alarms');
const { validateSubscription, isAllowedEndpoint } = require('../services/push');

/* ---------- fixtures ---------- */

const HOURS = Array.from({ length: 24 }, (_, i) => `2026-11-14T${String(i).padStart(2, '0')}:00`);

/** Open-Meteo-shaped payload: "now" is 10:05; rain (80%) at 12:00; temp drop 20->8 between 12:00 and 15:00. */
function forecastWithShifts({ rain = true, drop = true } = {}) {
  const temps = Array(24).fill(drop ? 8 : 20);
  if (drop) { for (let i = 0; i <= 12; i++) temps[i] = 20; temps[13] = 16; temps[14] = 12; temps[15] = 8; }
  const codes = Array(24).fill(0);
  const probs = Array(24).fill(0);
  if (rain) { codes[12] = 61; probs[12] = 80; }
  return {
    current: { time: '2026-11-14T10:05', weather_code: 0, precipitation: 0 },
    hourly: { time: HOURS, temperature_2m: temps, weather_code: codes, precipitation_probability: probs },
  };
}

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BNcRdreALRFX', auth: 'tBHItJI5svbpez7KI4CCXg' } };
const CITY = { id: 7, name: 'Tokyo', country: 'JP', latitude: 35.68, longitude: 139.69 };

/** In-memory stand-in for models/push.js */
function fakePushModel({ targets }) {
  const log = new Set();
  const calls = { cleared: [], released: [] };
  return {
    calls,
    log,
    listAlarmTargets: async () => targets,
    pruneAlarmLog: async () => {},
    claimAlarm: async (key) => (log.has(key) ? false : (log.add(key), true)),
    releaseAlarm: async (key) => { log.delete(key); calls.released.push(key); },
    clearSubscription: async (endpoint) => { calls.cleared.push(endpoint); },
  };
}

function deps({ targets, cities = [CITY], data = forecastWithShifts(), sendResult = { ok: true } } = {}) {
  const push = fakePushModel({ targets });
  const sent = [];
  return {
    push,
    sent,
    cities: { listSavedCities: async () => cities },
    forecast: async () => ({ data }),
    send: async (subscription, payload) => { sent.push({ subscription, payload }); return sendResult; },
    configured: true,
    log: { log() {}, error() {} },
  };
}

const target = (over = {}) => ({ id: 1, push_subscription: SUB, alert_rain_changes: true, alert_temp_drops: true, ...over });

/* ---------- tests ---------- */

test('clockLabel formats Open-Meteo local times', () => {
  assert.strictEqual(clockLabel('2026-11-14T13:00'), '1:00 PM');
  assert.strictEqual(clockLabel('2026-11-14T00:00'), '12:00 AM');
  assert.strictEqual(clockLabel('2026-11-14T12:00'), '12:00 PM');
});

test('sends a "Rain starting at …" and a temperature-drop alarm', async () => {
  const d = deps({ targets: [target()] });
  const summary = await runAlarmCheck(d);
  assert.strictEqual(summary.sent, 2);
  const titles = d.sent.map((s) => s.payload.title).sort();
  assert.deepStrictEqual(titles, ['☂️ Tokyo: Rain starting at 12:00 PM', '🧥 Tokyo: Temperature dropping 12°C by 3:00 PM']);
  assert.ok(d.sent.every((s) => s.subscription === SUB));
  assert.match(d.sent[0].payload.url, /^\/\?city=Tokyo&country=JP&lat=35\.68&lon=139\.69$/);
});

test('does not repeat the same alarm on the next hourly run', async () => {
  const d = deps({ targets: [target()] });
  await runAlarmCheck(d);
  const second = await runAlarmCheck(d);
  assert.strictEqual(second.sent, 0);
  assert.strictEqual(second.duplicates, 2);
  assert.strictEqual(d.sent.length, 2);
});

test('respects the alert toggles', async () => {
  const noRain = deps({ targets: [target({ alert_rain_changes: false })] });
  await runAlarmCheck(noRain);
  assert.deepStrictEqual(noRain.sent.map((s) => s.payload.title), ['🧥 Tokyo: Temperature dropping 12°C by 3:00 PM']);

  const noTemp = deps({ targets: [target({ alert_temp_drops: false })] });
  await runAlarmCheck(noTemp);
  assert.deepStrictEqual(noTemp.sent.map((s) => s.payload.title), ['☂️ Tokyo: Rain starting at 12:00 PM']);
});

test('no targets, no cities, or no shifts -> nothing sent', async () => {
  assert.strictEqual((await runAlarmCheck(deps({ targets: [] }))).sent, 0);
  assert.strictEqual((await runAlarmCheck(deps({ targets: [target()], cities: [] }))).sent, 0);
  const calm = deps({ targets: [target()], data: forecastWithShifts({ rain: false, drop: false }) });
  assert.strictEqual((await runAlarmCheck(calm)).sent, 0);
});

test('skips entirely when VAPID keys are missing', async () => {
  const d = deps({ targets: [target()] });
  const summary = await runAlarmCheck({ ...d, configured: false });
  assert.ok(summary.skipped);
  assert.strictEqual(d.sent.length, 0);
});

test('expired subscription (410) is cleared and the alarm released for retry', async () => {
  const d = deps({ targets: [target()], sendResult: { ok: false, gone: true, statusCode: 410, error: 'Gone' } });
  const summary = await runAlarmCheck(d);
  assert.strictEqual(summary.cleared, 1);
  assert.strictEqual(d.sent.length, 1, 'stops sending to a dead subscription');
  assert.deepStrictEqual(d.push.calls.cleared, [SUB.endpoint]);
  assert.strictEqual(d.push.log.size, 0, 'claim released so a new subscription can still get it');
});

test('subscription rejected for a VAPID key mismatch (403) is cleared so the browser re-subscribes', async () => {
  const d = deps({ targets: [target()], sendResult: { ok: false, gone: false, resubscribe: true, statusCode: 403, error: 'credentials' } });
  const summary = await runAlarmCheck(d);
  assert.strictEqual(summary.cleared, 1);
  assert.deepStrictEqual(d.push.calls.cleared, [SUB.endpoint]);
  assert.strictEqual(d.sent.length, 1, 'stops after the first rejection');
});

test('transient push failure releases the claim but keeps the subscription', async () => {
  const d = deps({ targets: [target()], sendResult: { ok: false, gone: false, statusCode: 503, error: 'Unavailable' } });
  const summary = await runAlarmCheck(d);
  assert.strictEqual(summary.failed, 2);
  assert.strictEqual(summary.cleared, 0);
  assert.strictEqual(d.push.log.size, 0);
});

test('a forecast error for one city does not stop the others', async () => {
  const d = deps({ targets: [target()], cities: [{ ...CITY, id: 1, name: 'Broken' }, CITY] });
  d.forecast = async (lat) => { if (lat === CITY.latitude && d.forecast.calls++ === 0) throw new Error('timeout'); return { data: forecastWithShifts() }; };
  d.forecast.calls = 0;
  const summary = await runAlarmCheck(d);
  assert.strictEqual(summary.sent, 2);
});

test('snow and thunderstorm messages give the right advice', () => {
  const snow = buildMessage({ type: 'precip-onset', kind: 'snow', chance: 75, atIso: '2026-11-14T08:00' }, CITY);
  assert.strictEqual(snow.title, '❄️ Tokyo: Snow starting at 8:00 AM');
  assert.match(snow.body, /boots/);
  const storm = buildMessage({ type: 'precip-onset', kind: 'thunderstorm', chance: 90, atIso: '2026-11-14T17:00' }, CITY);
  assert.strictEqual(storm.title, '⛈️ Tokyo: Thunderstorm starting at 5:00 PM');
});

test('subscription validation only accepts real push-service endpoints', () => {
  assert.ok(validateSubscription(SUB));
  assert.ok(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(isAllowedEndpoint('https://web.push.apple.com/abc'));
  assert.ok(isAllowedEndpoint('https://wns2-by3p.notify.windows.com/w/?token=x'));
  assert.ok(!isAllowedEndpoint('http://fcm.googleapis.com/fcm/send/x'), 'http rejected');
  assert.ok(!isAllowedEndpoint('https://localhost:5432/'), 'internal host rejected');
  assert.ok(!isAllowedEndpoint('https://evil.com/fcm.googleapis.com'), 'lookalike rejected');
  assert.ok(!isAllowedEndpoint('https://fcm.googleapis.com.evil.com/x'), 'suffix trick rejected');
  assert.strictEqual(validateSubscription({ endpoint: SUB.endpoint, keys: { p256dh: 'x y', auth: 'z' } }), null);
  assert.strictEqual(validateSubscription(null), null);
});
