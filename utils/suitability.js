/**
 * utils/suitability.js
 * Rates current conditions for outdoor activities / drying laundry
 * against the user's saved thresholds.
 */

/**
 * @param {Object} weather  formatted weather (wind_speed km/h, humidity %, precipitation mm, rain_chance_3h %)
 * @param {Object} prefs    { max_wind_kmh, max_humidity_pct, max_rain_chance_pct }
 * @returns {{ level: 'good'|'fair'|'poor', label: string, checks: Array }}
 */
function evaluateSuitability(weather, prefs) {
  const raining = weather.precipitation > 0;

  const checks = [
    {
      key: 'rain',
      label: 'Rain chance (next 3h)',
      value: `${weather.rain_chance_3h}%`,
      limit: `≤ ${prefs.max_rain_chance_pct}%`,
      ok: !raining && weather.rain_chance_3h <= prefs.max_rain_chance_pct,
      note: raining ? `Currently raining (${weather.precipitation} mm)` : null,
    },
    {
      key: 'wind',
      label: 'Wind speed',
      value: `${weather.wind_speed} km/h`,
      limit: `≤ ${prefs.max_wind_kmh} km/h`,
      ok: weather.wind_speed <= prefs.max_wind_kmh,
    },
    {
      key: 'humidity',
      label: 'Humidity',
      value: `${weather.humidity}%`,
      limit: `≤ ${prefs.max_humidity_pct}%`,
      ok: weather.humidity <= prefs.max_humidity_pct,
    },
  ];

  const failed = checks.filter((c) => !c.ok);
  const rainFailed = failed.some((c) => c.key === 'rain');

  let level, label;
  if (failed.length === 0) {
    level = 'good';
    label = 'Great time to hang laundry or head outside';
  } else if (rainFailed || failed.length >= 2) {
    level = 'poor';
    label = 'Not a good time — keep laundry indoors';
  } else {
    level = 'fair';
    label = 'Okay, but one condition is past your limit';
  }

  return { level, label, checks };
}

module.exports = { evaluateSuitability };
