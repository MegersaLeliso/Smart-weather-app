/**
 * jobs/alarms.js
 * "Pack & Wear Just-in-Time Alarms" — an hourly node-cron task that:
 *   1. finds users with a push subscription and at least one alert toggle on,
 *   2. fetches the forecast for each of their saved cities (cache-aware),
 *   3. runs the existing shiftDetector + alert-toggle filter,
 *   4. sends a Web Push for each new shift starting within ALARM_LEAD_HOURS,
 *      e.g. "☂️ Tokyo: Rain starting at 1:00 PM".
 * Every alarm is recorded in push_notification_log so it is sent only once.
 */

const cron = require('node-cron');
const pushModel = require('../models/push');
const savedCities = require('../models/savedCities');
const { getForecast } = require('../services/forecast');
const pushService = require('../services/push');
const { detectMajorShifts, applyAlertPreferences } = require('../utils/shiftDetector');

const SCHEDULE = '0 * * * *';   // top of every hour
const ALARM_LEAD_HOURS = 3;     // only alarm for shifts that start within this many hours
const ALARM_TYPES = new Set(['precip-onset', 'temp-drop']); // the two user-toggleable alerts

/** "2026-11-14T13:00" -> "1:00 PM" (Open-Meteo times are already in the city's local time). */
function clockLabel(iso) {
  const [, time = ''] = String(iso).split('T');
  const [hStr, mStr = '00'] = time.split(':');
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return '';
  return `${h % 12 || 12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Builds the notification payload for one shift ("what to pack / wear"). */
function buildMessage(shift, city) {
  const at = clockLabel(shift.atIso);
  const params = new URLSearchParams({
    city: city.name, country: city.country || '', lat: String(city.latitude), lon: String(city.longitude),
  });
  const url = `/?${params.toString()}`;

  if (shift.type === 'precip-onset') {
    const advice = {
      rain: 'Pack an umbrella before you head out.',
      snow: 'Wear boots and a warm coat.',
      thunderstorm: 'Storms likely: pack an umbrella and plan to be indoors.',
    }[shift.kind] || 'Pack an umbrella.';
    const icon = shift.kind === 'snow' ? '❄️' : shift.kind === 'thunderstorm' ? '⛈️' : '☂️';
    return {
      title: `${icon} ${city.name}: ${capitalize(shift.kind || 'rain')} starting at ${at}`,
      body: `${advice} Chance rises to ${shift.chance}%.`,
      url,
    };
  }

  // temp-drop
  return {
    title: `🧥 ${city.name}: Temperature dropping ${shift.amount}°C by ${at}`,
    body: `Wear an extra layer: ${shift.fromTemp}°C → ${shift.toTemp}°C.`,
    url,
  };
}

/**
 * Runs one alarm sweep. Dependencies are injectable for testing.
 * @returns {Promise<Object>} summary of what happened
 */
async function runAlarmCheck(deps = {}) {
  const {
    push = pushModel,
    cities = savedCities,
    forecast = getForecast,
    send = pushService.sendPush,
    configured = pushService.isConfigured(),
    log = console,
  } = deps;

  const summary = { targets: 0, cities: 0, shifts: 0, sent: 0, duplicates: 0, failed: 0, cleared: 0 };
  if (!configured) return { ...summary, skipped: 'Web Push not configured' };

  const targets = await push.listAlarmTargets();
  summary.targets = targets.length;
  if (!targets.length) return summary;

  const cityList = await cities.listSavedCities();
  summary.cities = cityList.length;
  if (!cityList.length) return summary;

  await push.pruneAlarmLog();

  // Fetch each city's forecast once, even if several targets watch it
  const shiftsByCity = new Map();
  for (const city of cityList) {
    try {
      const { data } = await forecast(city.latitude, city.longitude);
      shiftsByCity.set(city.id, detectMajorShifts(data));
    } catch (err) {
      log.error(`[ALARMS] forecast failed for ${city.name}:`, err.message);
    }
  }

  for (const target of targets) {
    let subscriptionGone = false;
    for (const city of cityList) {
      if (subscriptionGone) break;
      const result = applyAlertPreferences(shiftsByCity.get(city.id) || null, target);
      if (!result) continue;

      const due = result.shifts.filter((s) => ALARM_TYPES.has(s.type) && s.hoursAway >= 0 && s.hoursAway <= ALARM_LEAD_HOURS);
      for (const shift of due) {
        summary.shifts++;
        const key = `${target.id}:${city.id}:${shift.type}:${shift.atIso}`;
        if (!(await push.claimAlarm(key))) { summary.duplicates++; continue; }

        const message = buildMessage(shift, city);
        const res = await send(target.push_subscription, { ...message, tag: key });
        if (res.ok) {
          summary.sent++;
          log.log(`[ALARMS] sent "${message.title}"`);
        } else {
          summary.failed++;
          await push.releaseAlarm(key); // allow a retry next hour
          log.error(`[ALARMS] push failed (${res.statusCode || 'n/a'}): ${res.error}`);
          if (res.gone || res.resubscribe) {
            await push.clearSubscription(target.push_subscription && target.push_subscription.endpoint);
            summary.cleared++;
            subscriptionGone = true;
            break;
          }
        }
      }
    }
  }
  return summary;
}

let task = null;

/** Starts the hourly schedule (idempotent). Set ALARMS_DISABLED=1 to turn it off. */
function startAlarmSchedule() {
  if (task) return task;
  if (process.env.ALARMS_DISABLED === '1') {
    console.log('[ALARMS] disabled via ALARMS_DISABLED=1');
    return null;
  }
  if (!pushService.isConfigured()) {
    console.log('[ALARMS] Web Push not configured (VAPID_* missing in .env); hourly alarms are off');
    return null;
  }
  task = cron.schedule(SCHEDULE, async () => {
    try {
      const summary = await runAlarmCheck();
      console.log('[ALARMS] hourly check:', JSON.stringify(summary));
    } catch (err) {
      console.error('[ALARMS] hourly check failed:', err.message);
    }
  }, { name: 'pack-and-wear-alarms', noOverlap: true });
  console.log(`[ALARMS] Pack & Wear alarms scheduled (${SCHEDULE})`);
  return task;
}

module.exports = { runAlarmCheck, startAlarmSchedule, buildMessage, clockLabel, ALARM_LEAD_HOURS };
