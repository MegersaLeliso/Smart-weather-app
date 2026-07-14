# Smart Weather

A weather dashboard built with Node.js, Express, and EJS, using the Open-Meteo API for geocoding and forecast data.

🔗 **Live demo:** https://smart-weather-app-2ktj.onrender.com

> Note: hosted on Render's free tier, which spins down after inactivity. The first request after idle time may take 30-60 seconds to respond.

## Features
- Search any city and get current conditions, humidity, wind speed, and a 6-hour forecast
- City autocomplete with country/region disambiguation
- Outdoor/laundry suitability indicator based on upcoming precipitation, wind, and humidity
- Background theme that changes based on the searched location's actual day/sunset/night state

## Prerequisites
- Node.js (v18 or higher recommended)
- npm

## Setup

1. Clone the repository
git clone https://github.com/MegersaLeliso/smart-weather-app.git
cd smart-weather-app
2. Install dependencies
npm install
3. Start the server
npm start
4. Open http://localhost:3000 in your browser

## Built with
- Node.js + Express
- EJS templating
- Axios
- [Open-Meteo API](https://open-meteo.com)

## Author
Megersa Leliso





