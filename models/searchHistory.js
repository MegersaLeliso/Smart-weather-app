/**
 * models/searchHistory.js
 * Logs every successful city lookup and exposes the most recent distinct ones.
 */

const pool = require('../db');

const MAX_ROWS = 100;

async function logSearch({ name, country, latitude, longitude }) {
  await pool.query(
    `INSERT INTO search_history (name, country, latitude, longitude)
     VALUES ($1, $2, $3, $4)`,
    [name, country || '', latitude, longitude]
  );
  // Keep the table bounded: drop anything older than the newest MAX_ROWS rows.
  await pool.query(
    `DELETE FROM search_history
     WHERE id NOT IN (SELECT id FROM search_history ORDER BY searched_at DESC, id DESC LIMIT $1)`,
    [MAX_ROWS]
  );
}

/** Most recent searches, one row per city (name + country), newest first. */
async function listRecentSearches(limit = 8) {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (lower(name), country) name, country, latitude, longitude, searched_at
       FROM search_history
       ORDER BY lower(name), country, searched_at DESC
     ) latest
     ORDER BY searched_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    name: r.name,
    country: r.country,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    searched_at: r.searched_at,
  }));
}

async function clearHistory() {
  await pool.query('DELETE FROM search_history');
}

module.exports = { logSearch, listRecentSearches, clearHistory };
