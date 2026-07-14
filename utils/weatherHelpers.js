/**
 * weatherHelpers.js
 * Utility functions to format and transform raw Open-Meteo API data
 * into a clean, view-friendly object with inline SVG support.
 */

const fs = require('fs');
const path = require('path');

/**
 * Converts an ISO time string "YYYY-MM-DDTHH:MM" to "HH:MM AM/PM".
 * @param {string} isoStr
 * @returns {string}
 */
function formatLocalTime(isoStr) {
  if (!isoStr) return '';
  const parts = isoStr.split('T');
  if (parts.length < 2) return '';
  const timePart = parts[1]; // "HH:MM"
  const timeParts = timePart.split(':');
  let hour = parseInt(timeParts[0]);
  const min = timeParts[1];
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12;
  const hourStr = hour < 10 ? '0' + hour : hour;
  return `${hourStr}:${min} ${ampm}`;
}

/**
 * Formats an ISO date string "YYYY-MM-DD" to a human-friendly string.
 * @param {string} isoStr
 * @returns {string}
 */
function formatLocalDate(isoStr) {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

/**
 * Maps a WMO weather code to the corresponding local SVG icon filename.
 * @param {number} code
 * @returns {string}
 */
function mapWmoToIcon(code) {
  const mapping = {
    0: 'clear.svg',
    1: 'clouds.svg',
    2: 'clouds.svg',
    3: 'clouds.svg',
    45: 'mist.svg',
    48: 'mist.svg',
    51: 'rain.svg',
    53: 'rain.svg',
    55: 'rain.svg',
    56: 'rain.svg',
    57: 'rain.svg',
    61: 'rain.svg',
    63: 'rain.svg',
    65: 'rain.svg',
    66: 'rain.svg',
    67: 'rain.svg',
    80: 'moderate_heavy_rain.svg',
    81: 'moderate_heavy_rain.svg',
    82: 'moderate_heavy_rain.svg',
    71: 'snow.svg',
    73: 'snow.svg',
    75: 'snow.svg',
    77: 'snow.svg',
    85: 'snow.svg',
    86: 'snow.svg',
    95: 'thunder.svg',
    96: 'thunder_rain.svg',
    99: 'thunder_rain.svg'
  };
  return mapping[code] || 'no-result.svg';
}

/**
 * Reads the content of an SVG file and returns it as an inline string.
 * Falls back to no-result.svg if the target file is missing.
 * @param {string} filename
 * @returns {string}
 */
function getInlineSvg(filename) {
  try {
    const filePath = path.join(__dirname, '..', 'public', 'icons', filename);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.error(`Error reading SVG ${filename}:`, err.message);
  }
  try {
    const fallbackPath = path.join(__dirname, '..', 'public', 'icons', 'no-result.svg');
    if (fs.existsSync(fallbackPath)) {
      return fs.readFileSync(fallbackPath, 'utf8');
    }
  } catch (e) {}
  return '';
}

/**
 * Transforms the raw Open-Meteo API response into a view-friendly object.
 * @param {Object} data — Raw API response
 * @param {string} cityName
 * @param {string} countryCode
 * @returns {Object}
 */
function formatWeatherData(data, cityName, countryCode) {
  const current = data.current;
  const daily = data.daily;
  const hourly = data.hourly;

  const is_day = current.is_day === 1;

  // Determine theme: day, sunset, or night
  let theme = 'day';
  if (!is_day) {
    theme = 'night';
  } else {
    const currentTimeStr = current.time; // "2026-07-13T10:15"
    const sunsetTimeStr = daily.sunset[0]; // "2026-07-13T21:14"
    const sunriseTimeStr = daily.sunrise[0]; // "2026-07-13T04:59"

    const currentMs = new Date(currentTimeStr).getTime();
    const sunsetMs = new Date(sunsetTimeStr).getTime();
    const sunriseMs = new Date(sunriseTimeStr).getTime();

    const msToSunset = sunsetMs - currentMs;
    const msSinceSunrise = currentMs - sunriseMs;

    // Within 1.5 hours of sunset or 1 hour of sunrise
    if ((msToSunset > -1800000 && msToSunset < 5400000) || (msSinceSunrise > 0 && msSinceSunrise < 3600000)) {
      theme = 'sunset';
    } else {
      theme = 'day';
    }
  }

  // WMO weather code descriptions
  const descriptions = {
    0: 'clear sky',
    1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'depositing rime fog',
    51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
    56: 'light freezing drizzle', 57: 'dense freezing drizzle',
    61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain',
    66: 'light freezing rain', 67: 'heavy freezing rain',
    71: 'slight snow fall', 73: 'moderate snow fall', 75: 'heavy snow fall',
    77: 'snow grains',
    80: 'slight rain showers', 81: 'moderate rain showers', 82: 'violent rain showers',
    85: 'slight snow showers', 86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with slight hail', 99: 'thunderstorm with heavy hail'
  };

  const description = descriptions[current.weather_code] || 'unknown conditions';

  // Process hourly forecast: next 8 hours starting from the current hour
  const currentHourPrefix = current.time.substring(0, 13);
  const startIdx = hourly.time.findIndex(t => t.startsWith(currentHourPrefix));
  
  const hourlyStrip = [];
  const safeStart = startIdx !== -1 ? startIdx : 0;
  for (let i = safeStart; i < safeStart + 8 && i < hourly.time.length; i++) {
    const wmoCode = hourly.weather_code[i];
    const iconName = mapWmoToIcon(wmoCode);
    hourlyStrip.push({
      time: formatLocalTime(hourly.time[i]),
      temp: Math.round(hourly.temperature_2m[i]),
      iconSvg: getInlineSvg(iconName)
    });
  }

  const currentIconName = mapWmoToIcon(current.weather_code);

  return {
    city: cityName,
    country: countryCode,
    date: formatLocalDate(current.time.split('T')[0]),
    temp: Math.round(current.temperature_2m),
    feels_like: Math.round(current.apparent_temperature),
    description: description,
    iconSvg: getInlineSvg(currentIconName),
    humidity: current.relative_humidity_2m,
    pressure: Math.round(current.pressure_msl),
    wind_speed: current.wind_speed_10m,
    visibility: 10.0, // Default visibility fallback
    sunrise: formatLocalTime(daily.sunrise[0]),
    sunset: formatLocalTime(daily.sunset[0]),
    is_day: is_day,
    theme: theme,
    hourly: hourlyStrip
  };
}

module.exports = { formatWeatherData };
