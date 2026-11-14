/**
 * routes/weather.js
 * Handles the weather endpoint using the Open-Meteo weather API, plus the
 * PostgreSQL-backed features: saved cities, forecast cache, search history
 * and outdoor/laundry preferences.
 *
 * Every database call is wrapped so that if PostgreSQL is unavailable the
 * dashboard still renders live weather — the DB-backed sections simply hide.
 */

const express = require('express');
const axios = require('axios');
const { formatWeatherData } = require('../utils/weatherHelpers');
const { evaluateSuitability } = require('../utils/suitability');
const savedCities = require('../models/savedCities');
const weatherCache = require('../models/weatherCache');
const searchHistory = require('../models/searchHistory');
const preferences = require('../models/preferences');

const router = express.Router();

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Runs a DB operation; logs and returns `fallback` on failure instead of throwing. */
async function safeDb(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[DB WARN] ${label}:`, err.message);
    return fallback;
  }
}

/** Only allow redirects back to a local path (prevents open redirects). */
function safeReturnTo(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return '/';
}

const sameCoords = (a, b) =>
  Math.abs(Number(a.latitude) - Number(b.latitude)) < 1e-4 &&
  Math.abs(Number(a.longitude) - Number(b.longitude)) < 1e-4;

/** Loads the DB-backed sidebar data and renders the dashboard. */
async function renderDashboard(req, res, { weather = null, error = null, city = '' }) {
  const [saved, recent, prefs] = await Promise.all([
    safeDb('list saved cities', () => savedCities.listSavedCities(), null),
    safeDb('list recent searches', () => searchHistory.listRecentSearches(8), null),
    safeDb('load preferences', () => preferences.getPreferences(), null),
  ]);

  const effectivePrefs = prefs || { ...preferences.DEFAULT_PREFS };
  let suitability = null;
  let savedMatch = null;
  if (weather) {
    suitability = evaluateSuitability(weather, effectivePrefs);
    savedMatch = saved ? saved.find((c) => sameCoords(c, weather)) || null : null;
  }

  res.render('index', {
    weather,
    error,
    city,
    savedCities: saved,          // null => DB unavailable, section hidden
    recentSearches: recent,      // null => DB unavailable, section hidden
    preferences: effectivePrefs,
    dbAvailable: prefs !== null,
    suitability,
    savedMatch,
    returnTo: req.originalUrl,
  });
}

/** Fetches the forecast, serving from the PostgreSQL cache when fresh. */
async function getForecast(lat, lon) {
  const cached = await safeDb('read cache', () => weatherCache.getCachedForecast(lat, lon), null);
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
  });

  await safeDb('write cache', () => weatherCache.setCachedForecast(lat, lon, response.data));
  return { data: response.data, fromCache: false, fetchedAt: new Date() };
}

/**
 * Resolves free-text input like "London", "London, GB", "London, Canada" or
 * "Springfield, Illinois, US" (the format the search box displays).
 * Only the name is sent to the geocoder; the remaining comma parts pick the
 * right match: a trailing 2-letter part is an ISO country code, and any other
 * part is matched against the region (admin1) or country name.
 */
async function geocodeCity(input) {
  const parts = input.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  const name = parts[0];
  const hints = parts.slice(1);
  const last = hints[hints.length - 1];
  const countryCode = last && /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : null;
  const placeHints = (countryCode ? hints.slice(0, -1) : hints).map((h) => h.toLowerCase());

  const search = async (extra = {}) => {
    const { data } = await axios.get(GEOCODE_URL, { params: { name, count: 10, ...extra } });
    return data.results || [];
  };

  let results = countryCode ? await search({ countryCode }) : await search();
  // Unknown country code (e.g. a typo): fall back to an unfiltered search
  if (!results.length && countryCode) results = await search();
  if (!results.length) return null;

  if (placeHints.length) {
    const matches = (r) =>
      placeHints.every((h) =>
        [r.admin1, r.admin2, r.country].some((v) => v && v.toLowerCase().startsWith(h))
      );
    const best = results.find(matches);
    if (best) return best;
  }
  return results[0];
}

router.get('/', async (req, res) => {
  const city = req.query.city;
  const lat = req.query.lat;
  const lon = req.query.lon;

  const hasCoords = lat && lon && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lon));
  const hasCity = city && city.trim();

  // No city or coordinates supplied — show the welcome state
  if (!hasCity && !hasCoords) {
    return renderDashboard(req, res, {});
  }

  try {
    let targetLat, targetLon, cityName, countryCode;

    if (hasCoords) {
      targetLat = parseFloat(lat);
      targetLon = parseFloat(lon);
      cityName = hasCity ? city.trim() : 'Unknown Location';
      countryCode = '';

      // Parse city name and country code from composite input value if available
      if (hasCity) {
        const parts = city.split(',');
        cityName = parts[0].trim();
        countryCode = parts.length > 2 ? parts[parts.length - 1].trim() : '';
      }
      // Saved-city chips and recent-search links pass the country explicitly
      if (req.query.country) countryCode = String(req.query.country).trim();
    } else {
      // Resolve city name to coordinates using Open-Meteo Geocoding API
      const geo = await geocodeCity(city);

      if (!geo) {
        return renderDashboard(req, res, {
          error: `City "${city}" not found. Please check the spelling and try again.`,
          city: city.trim(),
        });
      }

      targetLat = geo.latitude;
      targetLon = geo.longitude;
      cityName = geo.name;
      countryCode = geo.country_code || '';
    }

    const { data, fromCache, fetchedAt } = await getForecast(targetLat, targetLon);

    const weather = formatWeatherData(data, cityName, countryCode);
    // Use the requested coordinates (Open-Meteo snaps its own to a grid cell)
    weather.latitude = targetLat;
    weather.longitude = targetLon;
    weather.fromCache = fromCache;
    weather.ageMinutes = Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 60000));

    await safeDb('log search', () =>
      searchHistory.logSearch({ name: cityName, country: countryCode, latitude: targetLat, longitude: targetLon })
    );

    return renderDashboard(req, res, {
      weather,
      city: countryCode ? `${cityName}, ${countryCode}` : cityName,
    });
  } catch (err) {
    console.error('[ROUTE ERROR]:', err.message);
    return renderDashboard(req, res, {
      error: 'Unable to fetch weather data. Please check your connection and try again.',
      city: hasCity ? city.trim() : '',
    });
  }
});

/* ---------- Saved / pinned cities ---------- */

router.post('/cities', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 120);
    const country = String(req.body.country || '').trim().slice(0, 10);
    const latitude = parseFloat(req.body.latitude);
    const longitude = parseFloat(req.body.longitude);

    if (name && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      await savedCities.saveCity({ name, country, latitude, longitude });
    }
    res.redirect(303, safeReturnTo(req.body.returnTo));
  } catch (err) {
    next(err);
  }
});

router.post('/cities/:id/delete', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isInteger(id)) await savedCities.deleteCity(id);
    res.redirect(303, safeReturnTo(req.body.returnTo));
  } catch (err) {
    next(err);
  }
});

/* ---------- Search history ---------- */

router.post('/history/clear', async (req, res, next) => {
  try {
    await searchHistory.clearHistory();
    res.redirect(303, safeReturnTo(req.body.returnTo));
  } catch (err) {
    next(err);
  }
});

/* ---------- Outdoor / laundry preferences ---------- */

const clamp = (v, min, max, fallback) => {
  const n = parseFloat(v);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

router.post('/preferences', async (req, res, next) => {
  try {
    const d = preferences.DEFAULT_PREFS;
    await preferences.updatePreferences({
      max_wind_kmh: Math.round(clamp(req.body.max_wind_kmh, 0, 200, d.max_wind_kmh) * 10) / 10,
      max_humidity_pct: Math.round(clamp(req.body.max_humidity_pct, 0, 100, d.max_humidity_pct)),
      max_rain_chance_pct: Math.round(clamp(req.body.max_rain_chance_pct, 0, 100, d.max_rain_chance_pct)),
    });
    res.redirect(303, safeReturnTo(req.body.returnTo));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
