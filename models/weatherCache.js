/**
 * models/weatherCache.js
 * Caches raw Open-Meteo forecast responses keyed by coordinates rounded
 * to 2 decimals (~1 km), so repeat searches skip the external API.
 */

const pool = require('../db');

const TTL_MINUTES = Number(process.env.CACHE_TTL_MINUTES) || 20;

const roundKey = (n) => Math.round(Number(n) * 100) / 100;

/** Returns { payload, fetched_at } if younger than the TTL, otherwise null. */
async function getCachedForecast(lat, lon) {
  const { rows } = await pool.query(
    `SELECT payload, fetched_at FROM weather_cache
     WHERE lat_key = $1 AND lon_key = $2
       AND fetched_at > now() - make_interval(mins => $3)`,
    [roundKey(lat), roundKey(lon), TTL_MINUTES]
  );
  return rows.length ? rows[0] : null;
}

async function setCachedForecast(lat, lon, payload) {
  await pool.query(
    `INSERT INTO weather_cache (lat_key, lon_key, payload, fetched_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (lat_key, lon_key)
     DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
    [roundKey(lat), roundKey(lon), JSON.stringify(payload)]
  );
}

module.exports = { getCachedForecast, setCachedForecast, TTL_MINUTES };
