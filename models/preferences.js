/**
 * models/preferences.js
 * Single-row (id = 1) outdoor / laundry thresholds plus the seasonal
 * notification toggles that control the Major Shift warning card.
 */

const pool = require('../db');

const DEFAULT_PREFS = {
  max_wind_kmh: 25,
  max_humidity_pct: 75,
  max_rain_chance_pct: 20,
  alert_rain_changes: true,
  alert_temp_drops: true,
};

async function getPreferences() {
  const { rows } = await pool.query(
    `SELECT max_wind_kmh, max_humidity_pct, max_rain_chance_pct, alert_rain_changes, alert_temp_drops
       FROM user_preferences WHERE id = 1`
  );
  if (!rows.length) return { ...DEFAULT_PREFS };
  return {
    max_wind_kmh: Number(rows[0].max_wind_kmh),
    max_humidity_pct: Number(rows[0].max_humidity_pct),
    max_rain_chance_pct: Number(rows[0].max_rain_chance_pct),
    alert_rain_changes: rows[0].alert_rain_changes !== false,
    alert_temp_drops: rows[0].alert_temp_drops !== false,
  };
}

async function updatePreferences({
  max_wind_kmh, max_humidity_pct, max_rain_chance_pct, alert_rain_changes, alert_temp_drops,
}) {
  await pool.query(
    `INSERT INTO user_preferences
       (id, max_wind_kmh, max_humidity_pct, max_rain_chance_pct, alert_rain_changes, alert_temp_drops, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       max_wind_kmh = EXCLUDED.max_wind_kmh,
       max_humidity_pct = EXCLUDED.max_humidity_pct,
       max_rain_chance_pct = EXCLUDED.max_rain_chance_pct,
       alert_rain_changes = EXCLUDED.alert_rain_changes,
       alert_temp_drops = EXCLUDED.alert_temp_drops,
       updated_at = now()`,
    [max_wind_kmh, max_humidity_pct, max_rain_chance_pct, Boolean(alert_rain_changes), Boolean(alert_temp_drops)]
  );
}

module.exports = { getPreferences, updatePreferences, DEFAULT_PREFS };
