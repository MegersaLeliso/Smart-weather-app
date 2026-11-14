/**
 * models/push.js
 * Web Push subscription storage (on the single user_preferences row) and the
 * de-duplication log used by the hourly Pack & Wear alarm job.
 */

const pool = require('../db');

async function getSubscription() {
  const { rows } = await pool.query('SELECT push_subscription FROM user_preferences WHERE id = 1');
  return rows.length ? rows[0].push_subscription : null;
}

async function saveSubscription(subscription) {
  await pool.query(
    `INSERT INTO user_preferences (id, push_subscription, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET push_subscription = EXCLUDED.push_subscription, updated_at = now()`,
    [JSON.stringify(subscription)]
  );
}

/** Clears the stored subscription; when `endpoint` is given, only if it still matches. */
async function clearSubscription(endpoint) {
  if (endpoint) {
    await pool.query(
      `UPDATE user_preferences SET push_subscription = NULL, updated_at = now()
        WHERE id = 1 AND push_subscription->>'endpoint' = $1`,
      [endpoint]
    );
  } else {
    await pool.query('UPDATE user_preferences SET push_subscription = NULL, updated_at = now() WHERE id = 1');
  }
}

/** Users with a subscription and at least one alert toggle on (one row in this app). */
async function listAlarmTargets() {
  const { rows } = await pool.query(
    `SELECT id, push_subscription, alert_rain_changes, alert_temp_drops
       FROM user_preferences
      WHERE push_subscription IS NOT NULL AND (alert_rain_changes OR alert_temp_drops)`
  );
  return rows;
}

/**
 * Atomically claims a dedupe key. Returns true if this is the first time
 * (the alarm should be sent), false if it was already sent.
 */
async function claimAlarm(key) {
  const { rowCount } = await pool.query(
    'INSERT INTO push_notification_log (dedupe_key) VALUES ($1) ON CONFLICT (dedupe_key) DO NOTHING',
    [key]
  );
  return rowCount === 1;
}

/** Releases a claim (used when the push itself fails, so the next run can retry). */
async function releaseAlarm(key) {
  await pool.query('DELETE FROM push_notification_log WHERE dedupe_key = $1', [key]);
}

/** Drops log rows older than two days (alarms only look 12 h ahead). */
async function pruneAlarmLog() {
  await pool.query("DELETE FROM push_notification_log WHERE sent_at < now() - interval '2 days'");
}

module.exports = {
  getSubscription, saveSubscription, clearSubscription,
  listAlarmTargets, claimAlarm, releaseAlarm, pruneAlarmLog,
};
