-- Hermit Crab Sightings Tracker - D1 Schema
-- Run this in your Cloudflare D1 console or via wrangler:
--   wrangler d1 execute hermit-crabs --file=schema.sql

CREATE TABLE IF NOT EXISTS sightings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lat         REAL    NOT NULL,
  lng         REAL    NOT NULL,
  species     TEXT,                        -- e.g. "Purple Pincher", "Ecuadorian"
  description TEXT    NOT NULL,
  nickname    TEXT    NOT NULL DEFAULT 'Anonymous',
  photo_url   TEXT,                        -- optional external image link
  upvotes     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sighting_id INTEGER NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
  nickname    TEXT    NOT NULL DEFAULT 'Anonymous',
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upvote_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sighting_id INTEGER NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
  fingerprint TEXT    NOT NULL,            -- simple IP+UA hash to prevent double-voting
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sighting_id, fingerprint)
);

-- Seed a couple of example sightings so the map isn't empty on launch
INSERT OR IGNORE INTO sightings (id, lat, lng, species, description, nickname, upvotes)
VALUES
  (1,  18.4655, -66.1057, 'Purple Pincher',  'Found a whole colony under rocks near the tide pools!', 'CrabWatcher', 12),
  (2, -17.5333, -149.8333,'Coconut Crab',    'Giant coconut crab spotted climbing a palm at dusk.',   'TahitiDiver',  8),
  (3,  25.0330,  121.5654, 'Hermit Crab sp.', 'Small hermit crabs in the rocky intertidal zone.',     'TaiwanBeach',  3);
