# Smart Weather

A weather dashboard built with Node.js, Express, and EJS, using the Open-Meteo API for geocoding and forecast data, PostgreSQL for persistence, and Three.js + MapLibre GL JS for interactive 3D visuals.

🔗 **Live demo:** https://smart-weather-app-2ktj.onrender.com

> Note: hosted on Render's free tier, which spins down after inactivity. The first request after idle time may take 30-60 seconds to respond.

## Features

### Weather
- Search any city and get current conditions, humidity, wind speed, pressure, and an 8-hour forecast
- City autocomplete with country/region disambiguation
- Outdoor/laundry suitability indicator based on upcoming precipitation, wind, and humidity
- Background theme that changes based on the searched location's actual day/sunset/night state
- **Zero-Gate Onboarding** – first-time visitors (no recent searches) are asked for their location and get their local weather automatically. A declined prompt is remembered, and a *Use my location* button can always retry. Coordinates are rounded to ~11 m before being sent.
- **Major Shift Visualizer** – scans the next 12 hours of the hourly forecast and shows a bold warning card below the search bar when something changes fast:
  - temperature drops (or rises) by more than 10 °C within 3 hours
  - rain, snow, or thunderstorms start within 3 hours while it's dry now (≥ 50 % chance with a wet weather code, or ≥ 70 % chance on its own)

  The card includes a mini chart of temperature and rain chance with the shift window highlighted.

### Interactive 3D
- **3D weather hero** – custom low-poly models made in Blender (glowing sun, fluffy cloud, raincloud with raindrops, moon and stars), rendered with Three.js. The model matches the current condition and day/night state, with idle sway, gentle floating, hover tilt, and drag-to-spin (arrow keys work too). Falls back to the SVG icon if WebGL is unavailable.
- **Ambient particles** – a full-screen layer of falling rain, snow, drifting clouds, or twinkling stars that matches the forecast.
- **3D card tilt** – glassmorphism weather cards tilt in perspective with a moving glare highlight on hover (mouse/trackpad only).
- **3D City Sky View** – a collapsible map card powered by [MapLibre GL JS](https://maplibre.org) and [OpenFreeMap](https://openfreemap.org) (no API key needed). It flies the camera to the searched city at a 60° pitch with 3D extruded buildings and orbits gently until you drag or zoom. Sky, fog, lighting, and building colours follow the day/sunset/night theme. The map loads only when the card is expanded; it starts expanded on desktop and collapsed on phones, and your choice is remembered.

All animations respect the operating system's *reduce motion* setting.

### Saved data (PostgreSQL)
- **Saved cities** – star a city to pin it as a quick-access chip
- **Forecast cache** – Open-Meteo responses are cached for `CACHE_TTL_MINUTES` (default 20) to cut API calls
- **Search history** – recent searches with relative timestamps, plus a *Clear* button
- **Outdoor thresholds** – set your own max wind, humidity, and rain-chance limits for the suitability check
- **Seasonal notification toggles** – switch *Sudden rain changes* and *Temperature drops* warnings on or off; the Major Shift card respects these settings

If PostgreSQL is unavailable, the dashboard still shows live weather; the database-backed sections are simply hidden.

### Pack & Wear Just-in-Time Alarms (Web Push)
- Click **Enable** under *My Outdoor Thresholds → Seasonal notifications* to get browser notifications such as *"☂️ Tokyo: Rain starting at 1:00 PM — Pack an umbrella"* or *"🧥 Temperature dropping 12°C by 3:00 PM — Wear an extra layer"*.
- An hourly `node-cron` job checks every **saved city** with the Major Shift detector and only alerts for shifts starting within the next 3 hours. Your *Sudden rain changes* / *Temperature drops* toggles are respected, and each alarm is sent once (tracked in `push_notification_log`).
- **Send test** delivers a test notification. Stale subscriptions (for example one created with a different VAPID key) are detected and replaced automatically; push-service errors are logged with their HTTP status and reason.
- One subscription is stored at a time (`user_preferences.push_subscription`), so enabling alarms in another browser replaces the previous one.
- Alarms run only while the server is running; on hosts that sleep when idle (such as Render's free tier), hourly checks pause until the app wakes up.

## Prerequisites
- Node.js 20 or higher (required by node-cron 4)
- npm
- PostgreSQL (optional, needed for the saved-data features)
- A browser with WebGL for the 3D features

## Setup

1. Clone the repository
   ```bash
   git clone https://github.com/MegersaLeliso/smart-weather-app.git
   cd smart-weather-app
   ```
2. Install dependencies
   ```bash
   npm install
   ```
3. Configure the database (optional)
   ```bash
   cp .env.example .env          # then fill in your PostgreSQL credentials
   createdb weather_db
   psql -d weather_db -f db/schema.sql
   ```
   `schema.sql` is safe to re-run: on an existing database it adds any new columns (such as the notification toggles) without touching your data.
4. Configure Web Push for Pack & Wear alarms (optional)
   ```bash
   npx web-push generate-vapid-keys
   ```
   Put the keys in `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT` to a `mailto:` address or your site's `https://` URL (not localhost). Without these, alarms are switched off and the rest of the app works normally. Set `ALARMS_DISABLED=1` to turn off the hourly job.
5. Start the server
   ```bash
   npm start        # or: npm run dev  (auto-reload with nodemon)
   ```
6. Open http://localhost:3000 in your browser (push notifications need `localhost` or HTTPS)

### Tests
```bash
npm test
```
Runs the Pack & Wear alarm tests (`test/`), which use in-memory fakes, so they need no database, network, or push service.

## Project structure

```
server.js                 Express bootstrap
routes/weather.js         Dashboard route, saved cities, history, preferences
routes/push.js            Web Push subscribe / unsubscribe / test endpoints
services/forecast.js      Cache-aware Open-Meteo fetch (shared by route and alarm job)
services/push.js          web-push wrapper: VAPID setup, subscription validation, error reporting
jobs/alarms.js            Hourly Pack & Wear alarm job (node-cron)
utils/weatherHelpers.js   Open-Meteo formatting, theme + 3D model/particle mapping
utils/suitability.js      Outdoor/laundry evaluation
utils/shiftDetector.js    Major Shift detection, chart geometry, alert-toggle filtering
models/                   PostgreSQL data access
db/schema.sql             Database schema
views/                    EJS templates
public/js/hero3d.js       Three.js 3D weather hero
public/js/ambient.js      Particle layer + card tilt
public/js/skyview.js      MapLibre 3D City Sky View
public/js/push.js         Notification permission + push subscription UI
public/sw.js              Service worker that displays push notifications
test/                     node:test suites (npm test)
public/models/*.glb       3D weather models exported from Blender
blender/weather_models.blend  Blender source file for the models
```

## Built with
- Node.js + Express
- EJS templating
- Axios
- PostgreSQL (`pg`)
- [web-push](https://github.com/web-push-libs/web-push) + [node-cron](https://github.com/node-cron/node-cron) for alarms
- [Three.js](https://threejs.org) (loaded from CDN)
- [MapLibre GL JS](https://maplibre.org) + [OpenFreeMap](https://openfreemap.org) tiles (loaded from CDN)
- [Blender](https://www.blender.org) for the 3D models
- [Open-Meteo API](https://open-meteo.com)

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © OpenMapTiles.

## Author
Megersa Leliso
