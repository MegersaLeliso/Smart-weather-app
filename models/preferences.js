/**
 * models/preferences.js
 * Single-row (id = 1) outdoor / laundry thresholds.
 */

const pool = require('../db');

const DEFAULT_PREFS = { max_wind_kmh: 25, max_humidity_pct: 75, max_rain_chance_pct: 20 };

async function getPreferences() {
  const { rows } = await pool.query(
    'SELECT max_wind_kmh, max_humidity_pct, max_rain_chance_pct FROM user_preferences WHERE id = 1'
  );
  if (!rows.length) return { ...DEFAULT_PREFS };
  return {
    max_wind_kmh: Number(rows[0].max_wind_kmh),
    max_humidity_pct: Number(rows[0].max_humidity_pct),
    max_rain_chance_pct: Number(rows[0].max_rain_chance_pct),
  };
}

async function updatePreferences({ max_wind_kmh, max_humidity_pct, max_rain_chance_pct }) {
  await pool.query(
    `INSERT INTO user_preferences (id, max_wind_kmh, max_humidity_pct, max_rain_chance_pct, updated_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET
       max_wind_kmh = EXCLUDED.max_wind_kmh,
       max_humidity_pct = EXCLUDED.max_humidity_pct,
       max_rain_chance_pct = EXCLUDED.max_rain_chance_pct,
       updated_at = now()`,
    [max_wind_kmh, max_humidity_pct, max_rain_chance_pct]
  );
}

module.exports = { getPreferences, updatePreferences, DEFAULT_PREFS };
