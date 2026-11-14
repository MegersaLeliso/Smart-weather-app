/**
 * models/savedCities.js
 * Pinned / starred cities the user can reload in one click.
 */

const pool = require('../db');

const toCity = (r) => ({
  id: r.id,
  name: r.name,
  country: r.country,
  latitude: Number(r.latitude),
  longitude: Number(r.longitude),
  created_at: r.created_at,
});

async function listSavedCities() {
  const { rows } = await pool.query(
    'SELECT id, name, country, latitude, longitude, created_at FROM saved_cities ORDER BY created_at ASC'
  );
  return rows.map(toCity);
}

/** Saves a city; starring the same coordinates twice is a no-op. */
async function saveCity({ name, country, latitude, longitude }) {
  await pool.query(
    `INSERT INTO saved_cities (name, country, latitude, longitude)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (latitude, longitude) DO NOTHING`,
    [name, country || '', latitude, longitude]
  );
}

async function deleteCity(id) {
  await pool.query('DELETE FROM saved_cities WHERE id = $1', [id]);
}

module.exports = { listSavedCities, saveCity, deleteCity };
