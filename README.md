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

If PostgreSQL is unavailable, the dashboard still shows live weather; the database-backed sections are simply hidden.

## Prerequisites
- Node.js (v18 or higher recommended)
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
4. Start the server
   ```bash
   npm start        # or: npm run dev  (auto-reload with nodemon)
   ```
5. Open http://localhost:3000 in your browser

## Project structure

```
server.js                 Express bootstrap
routes/weather.js         Dashboard route, saved cities, history, preferences
utils/weatherHelpers.js   Open-Meteo formatting, theme + 3D model/particle mapping
utils/suitability.js      Outdoor/laundry evaluation
models/                   PostgreSQL data access
db/schema.sql             Database schema
views/                    EJS templates
public/js/hero3d.js       Three.js 3D weather hero
public/js/ambient.js      Particle layer + card tilt
public/js/skyview.js      MapLibre 3D City Sky View
public/models/*.glb       3D weather models exported from Blender
blender/weather_models.blend  Blender source file for the models
```

## Built with
- Node.js + Express
- EJS templating
- Axios
- PostgreSQL (`pg`)
- [Three.js](https://threejs.org) (loaded from CDN)
- [MapLibre GL JS](https://maplibre.org) + [OpenFreeMap](https://openfreemap.org) tiles (loaded from CDN)
- [Blender](https://www.blender.org) for the 3D models
- [Open-Meteo API](https://open-meteo.com)

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © OpenMapTiles.

## Author
Megersa Leliso
