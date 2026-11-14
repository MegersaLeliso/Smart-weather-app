/**
 * services/forecast.js
 * Fetches an Open-Meteo forecast, serving from the PostgreSQL cache when fresh.
 * Shared by the dashboard route and the hourly Pack & Wear alarm job.
 */

const axios = require('axios');
const weatherCache = require('../models/weatherCache');

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** Cache failures must never break a forecast lookup. */
async function safeCache(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[DB WARN] ${label}:`, err.message);
    return fallback;
  }
}

async function getForecast(lat, lon) {
  const cached = await safeCache('read cache', () => weatherCache.getCachedForecast(lat, lon), null);
  if (cached) {
    return { data: cached.payload, fromCache: true, fetchedAt: new Date(cached.fetched_at) };
  }

  const response = await axios.get(FORECAST_URL, {
    params: {
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,weather_code,is_day,precipitation',
      daily: 'sunrise,sunset',
      hourly: 'temperature_2m,weather_code,precipitation_probability',
      timezone: 'auto',
    },
    timeout: 15000,
  });

  await safeCache('write cache', () => weatherCache.setCachedForecast(lat, lon, response.data));
  return { data: response.data, fromCache: false, fetchedAt: new Date() };
}

module.exports = { getForecast };
