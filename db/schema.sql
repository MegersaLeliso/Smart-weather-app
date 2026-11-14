-- Smart Weather schema. Safe to re-run (IF NOT EXISTS / ON CONFLICT).

CREATE TABLE IF NOT EXISTS saved_cities (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  country     VARCHAR(10)  NOT NULL DEFAULT '',
  latitude    NUMERIC(8,5) NOT NULL,
  longitude   NUMERIC(8,5) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS weather_cache (
  lat_key     NUMERIC(6,2) NOT NULL,
  lon_key     NUMERIC(6,2) NOT NULL,
  payload     JSONB        NOT NULL,
  fetched_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (lat_key, lon_key)
);

CREATE TABLE IF NOT EXISTS search_history (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  country      VARCHAR(10)  NOT NULL DEFAULT '',
  latitude     NUMERIC(8,5) NOT NULL,
  longitude    NUMERIC(8,5) NOT NULL,
  searched_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_history_searched_at ON search_history (searched_at DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  id                    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_wind_kmh          NUMERIC(5,1) NOT NULL DEFAULT 25 CHECK (max_wind_kmh >= 0),
  max_humidity_pct      SMALLINT     NOT NULL DEFAULT 75 CHECK (max_humidity_pct BETWEEN 0 AND 100),
  max_rain_chance_pct   SMALLINT     NOT NULL DEFAULT 20 CHECK (max_rain_chance_pct BETWEEN 0 AND 100),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
INSERT INTO user_preferences (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
