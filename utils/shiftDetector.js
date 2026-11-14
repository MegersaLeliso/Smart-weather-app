/**
 * shiftDetector.js
 * "Major Shift Visualizer" — scans the Open-Meteo hourly arrays for sudden
 * changes in the hours ahead and returns view-ready data (including an SVG
 * chart geometry) so index.ejs can render a warning card.
 *
 * Detected shifts:
 *   - temp-drop : temperature falls by more than TEMP_SHIFT_C within TEMP_SPAN_H hours
 *   - temp-rise : temperature climbs by more than TEMP_SHIFT_C within TEMP_SPAN_H hours
 *   - precip-onset : dry right now, then rain/snow/thunder with >=50% chance
 *                    (or any precipitation at >=70%) within ONSET_SPAN_H hours
 */

const LOOKAHEAD_H = 12;     // hours analysed (and charted) after the current hour
const TEMP_SHIFT_C = 10;    // °C change that counts as a major swing
const TEMP_SPAN_H = 3;      // ...within this many hours
const ONSET_SPAN_H = 3;     // precipitation must start within this many hours
const DRY_MAX_PROB = 30;    // "dry now" = rain chance below this...
const WET_MIN_PROB = 70;    // ...and onset = rain chance at/above this,
const CODE_MIN_PROB = 50;   // ...or a wet weather code backed by at least this chance

/** Precipitation type for a WMO weather code, or null when it's dry. */
function precipKind(code) {
  if (code >= 95) return 'thunderstorm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return null;
}

/** "2026-11-14T15:00" -> "3 PM" */
function hourLabel(iso) {
  const h = parseInt(String(iso).split('T')[1], 10);
  if (isNaN(h)) return '';
  return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`;
}

const isNum = (v) => typeof v === 'number' && isFinite(v);
const round = (v) => Math.round(v);

/**
 * Builds SVG geometry for the next LOOKAHEAD_H hours: a temperature line,
 * rain-chance bars, and highlighted bands for each detected shift.
 */
function buildChart(hourly, start, end, shifts) {
  const W = 320, H = 110;
  const pad = { l: 10, r: 10, t: 16, b: 22 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const n = end - start;
  const step = n > 0 ? plotW / n : plotW;
  const x = (i) => pad.l + (i - start) * step;

  const temps = [];
  for (let i = start; i <= end; i++) if (isNum(hourly.temperature_2m[i])) temps.push(hourly.temperature_2m[i]);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
  const y = (t) => pad.t + (1 - (t - lo) / (hi - lo)) * plotH;

  const points = [];
  for (let i = start; i <= end; i++) {
    const t = hourly.temperature_2m[i];
    if (isNum(t)) points.push(`${x(i).toFixed(1)},${y(t).toFixed(1)}`);
  }

  const probs = hourly.precipitation_probability || [];
  const barW = Math.max(3, step * 0.55);
  const bars = [];
  for (let i = start; i <= end; i++) {
    const p = isNum(probs[i]) ? probs[i] : 0;
    if (p <= 0) continue;
    const h = (p / 100) * plotH;
    bars.push({ x: +(x(i) - barW / 2).toFixed(1), y: +(pad.t + plotH - h).toFixed(1), w: +barW.toFixed(1), h: +h.toFixed(1) });
  }

  const bands = shifts.map((s) => {
    const x0 = s.type === 'precip-onset' ? x(s.toIndex) - step / 2 : x(s.fromIndex);
    const x1 = s.type === 'precip-onset' ? x(s.toIndex) + step / 2 : x(s.toIndex);
    return { type: s.type, x: +Math.max(pad.l, x0).toFixed(1), w: +(Math.min(W - pad.r, x1) - Math.max(pad.l, x0)).toFixed(1), y: pad.t, h: plotH, severity: s.severity };
  });

  const dots = [];
  shifts.filter((s) => s.type !== 'precip-onset').forEach((s) => {
    [s.fromIndex, s.toIndex].forEach((i) => {
      const t = hourly.temperature_2m[i];
      dots.push({ type: s.type, x: +x(i).toFixed(1), y: +y(t).toFixed(1), label: `${round(t)}°` });
    });
  });

  const ticks = [];
  for (let i = start; i <= end; i += 3) ticks.push({ x: +x(i).toFixed(1), label: i === start ? 'Now' : hourLabel(hourly.time[i]) });

  return { width: W, height: H, baseline: pad.t + plotH, points: points.join(' '), bars, bands, dots, ticks };
}

/**
 * Analyses the raw Open-Meteo response.
 * @param {Object} data — raw API response with `current` and `hourly`
 * @returns {null | {level: 'high'|'moderate', shifts: Array, chart: Object}}
 */
function detectMajorShifts(data) {
  const hourly = data && data.hourly;
  const current = data && data.current;
  if (!hourly || !current || !Array.isArray(hourly.time) || !Array.isArray(hourly.temperature_2m)) return null;

  const prefix = String(current.time || '').substring(0, 13);
  const start = hourly.time.findIndex((t) => t.startsWith(prefix));
  if (start === -1) return null;
  const end = Math.min(hourly.time.length - 1, start + LOOKAHEAD_H);
  if (end <= start) return null;

  const temps = hourly.temperature_2m;
  const codes = hourly.weather_code || [];
  const probs = hourly.precipitation_probability || [];
  const shifts = [];

  // --- Temperature swings: largest drop / rise over any window of up to TEMP_SPAN_H hours
  let drop = null, rise = null;
  for (let i = start; i < end; i++) {
    for (let k = 1; k <= TEMP_SPAN_H && i + k <= end; k++) {
      const j = i + k;
      if (!isNum(temps[i]) || !isNum(temps[j])) continue;
      const delta = temps[j] - temps[i];
      if (-delta > TEMP_SHIFT_C && (!drop || -delta > drop.amount)) drop = { from: i, to: j, amount: -delta };
      if (delta > TEMP_SHIFT_C && (!rise || delta > rise.amount)) rise = { from: i, to: j, amount: delta };
    }
  }
  if (drop) {
    shifts.push({
      type: 'temp-drop', severity: 'high', icon: 'ph-thermometer-cold',
      title: `Temperature plunge: −${round(drop.amount)}°C in ${drop.to - drop.from} h`,
      detail: `${round(temps[drop.from])}°C at ${hourLabel(hourly.time[drop.from])} → ${round(temps[drop.to])}°C by ${hourLabel(hourly.time[drop.to])}. Bring an extra layer.`,
      fromIndex: drop.from, toIndex: drop.to, hoursAway: drop.from - start,
      atIso: hourly.time[drop.to], amount: round(drop.amount),
      fromTemp: round(temps[drop.from]), toTemp: round(temps[drop.to]),
    });
  }
  if (rise) {
    shifts.push({
      type: 'temp-rise', severity: 'moderate', icon: 'ph-thermometer-hot',
      title: `Rapid warm-up: +${round(rise.amount)}°C in ${rise.to - rise.from} h`,
      detail: `${round(temps[rise.from])}°C at ${hourLabel(hourly.time[rise.from])} → ${round(temps[rise.to])}°C by ${hourLabel(hourly.time[rise.to])}.`,
      fromIndex: rise.from, toIndex: rise.to, hoursAway: rise.from - start,
      atIso: hourly.time[rise.to], amount: round(rise.amount),
      fromTemp: round(temps[rise.from]), toTemp: round(temps[rise.to]),
    });
  }

  // --- Sudden precipitation onset: dry now, wet within ONSET_SPAN_H hours
  const nowProb = isNum(probs[start]) ? probs[start] : 0;
  const nowWet = precipKind(current.weather_code) !== null || (isNum(current.precipitation) && current.precipitation > 0);
  if (!nowWet && nowProb < DRY_MAX_PROB) {
    for (let j = start + 1; j <= Math.min(end, start + ONSET_SPAN_H); j++) {
      const kind = precipKind(codes[j]);
      const hasProb = isNum(probs[j]);
      const p = hasProb ? probs[j] : 0;
      // A wet code alone isn't enough (models tag 10%-chance drizzle hours); require a real probability too
      if (p >= WET_MIN_PROB || (kind && (!hasProb || p >= CODE_MIN_PROB))) {
        const what = kind || 'rain';
        const hrs = j - start;
        shifts.push({
          type: 'precip-onset', severity: what === 'thunderstorm' ? 'high' : 'moderate',
          icon: what === 'snow' ? 'ph-snowflake' : what === 'thunderstorm' ? 'ph-cloud-lightning' : 'ph-cloud-rain',
          title: `Sudden ${what} onset in about ${hrs} h`,
          detail: `Dry now (${nowProb}% chance) → ${p}% chance of ${what} by ${hourLabel(hourly.time[j])}.`,
          fromIndex: start, toIndex: j, hoursAway: hrs,
          atIso: hourly.time[j], kind: what, chance: p,
        });
        break;
      }
    }
  }

  if (!shifts.length) return null;

  // Most severe first, then soonest
  shifts.sort((a, b) => (a.severity === b.severity ? a.hoursAway - b.hoursAway : a.severity === 'high' ? -1 : 1));

  return {
    level: shifts.some((s) => s.severity === 'high') ? 'high' : 'moderate',
    lookaheadHours: end - start,
    shifts,
    chart: buildChart(hourly, start, end, shifts),
  };
}

/**
 * Applies the user's seasonal notification toggles to a detectMajorShifts() result.
 *   alert_rain_changes = false -> hide sudden rain/snow/thunder onsets
 *   alert_temp_drops   = false -> hide temperature plunges
 * Returns a filtered copy, or null when nothing is left to show.
 */
function applyAlertPreferences(result, prefs) {
  if (!result || !prefs) return result;
  const hidden = new Set();
  if (prefs.alert_rain_changes === false) hidden.add('precip-onset');
  if (prefs.alert_temp_drops === false) hidden.add('temp-drop');
  if (!hidden.size) return result;

  const shifts = result.shifts.filter((s) => !hidden.has(s.type));
  if (!shifts.length) return null;
  return {
    ...result,
    level: shifts.some((s) => s.severity === 'high') ? 'high' : 'moderate',
    shifts,
    chart: {
      ...result.chart,
      bands: result.chart.bands.filter((b) => !hidden.has(b.type)),
      dots: result.chart.dots.filter((d) => !hidden.has(d.type)),
    },
  };
}

module.exports = { detectMajorShifts, applyAlertPreferences, precipKind, TEMP_SHIFT_C, TEMP_SPAN_H, ONSET_SPAN_H };
