-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Administrative boundaries table
CREATE TABLE admin_boundaries (
  id SERIAL PRIMARY KEY,
  wikidata_id VARCHAR(20) UNIQUE NOT NULL,
  commons_category VARCHAR(255) NOT NULL,
  admin_level INTEGER NOT NULL CHECK (admin_level BETWEEN 1 AND 10),
  name VARCHAR(255) NOT NULL,
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Spatial index for fast point-in-polygon queries
CREATE INDEX idx_admin_boundaries_geom ON admin_boundaries USING GIST(geom);

-- Index for admin_level queries
CREATE INDEX idx_admin_boundaries_admin_level ON admin_boundaries(admin_level);

-- Index for Wikidata lookups
CREATE INDEX idx_admin_boundaries_wikidata ON admin_boundaries(wikidata_id);
