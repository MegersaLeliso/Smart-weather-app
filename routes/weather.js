/**
 * routes/weather.js
 * Handles the weather endpoint using the Open-Meteo weather API.
 * Uses coordinates when available or falls back to resolving city name using Geocoding.
 */

const express = require('express');
const axios = require('axios');
const { formatWeatherData } = require('../utils/weatherHelpers');

const router = express.Router();

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

router.get('/', async (req, res) => {
  const city = req.query.city;
  const lat = req.query.lat;
  const lon = req.query.lon;

  const hasCoords = lat && lon && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lon));
  const hasCity = city && city.trim();
  const currentMonthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  // include currentMonthYear in whatever you pass to res.render(...)

  // No city or coordinates supplied — show the welcome state
  if (!hasCity && !hasCoords) {
    return res.render('index', { weather: null, error: null, city: '' });
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
    } else {
      // Resolve city name to coordinates using Open-Meteo Geocoding API
      const geoResponse = await axios.get(GEOCODE_URL, {
        params: {
          name: city.trim(),
          count: 1,
        },
      });

      if (!geoResponse.data.results || geoResponse.data.results.length === 0) {
        return res.render('index', {
          weather: null,
          error: `City "${city}" not found. Please check the spelling and try again.`,
          city: city.trim(),
        });
      }

      const geo = geoResponse.data.results[0];
      targetLat = geo.latitude;
      targetLon = geo.longitude;
      cityName = geo.name;
      countryCode = geo.country_code || '';
    }

    // Fetch weather forecast from Open-Meteo Forecast API
    const response = await axios.get(FORECAST_URL, {
      params: {
        latitude: targetLat,
        longitude: targetLon,
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,weather_code,is_day',
        daily: 'sunrise,sunset',
        hourly: 'temperature_2m,weather_code',
        timezone: 'auto',
      },
    });

    const weather = formatWeatherData(response.data, cityName, countryCode);

    res.render('index', {
      weather,
      error: null,
      city: countryCode ? `${cityName}, ${countryCode}` : cityName,
    });
  } catch (err) {
    console.error('[ROUTE ERROR]:', err.message);
    res.render('index', {
      weather: null,
      error: 'Unable to fetch weather data. Please check your connection and try again.',
      city: hasCity ? city.trim() : '',
    });
  }
});

module.exports = router;
