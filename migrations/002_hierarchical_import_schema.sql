-- Storage for OSM relation data
CREATE TABLE IF NOT EXISTS osm_relations (
  id SERIAL PRIMARY KEY,
  relation_id BIGINT NOT NULL,
  country_code VARCHAR(3) NOT NULL,
  admin_level INTEGER NOT NULL CHECK (admin_level BETWEEN 2 AND 11),
  name VARCHAR(255) NOT NULL,
  wikidata_id VARCHAR(20),
  parent_relation_id BIGINT,
  geometry GEOMETRY(Geometry, 4326),
  tags JSONB,
  fetched_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(relation_id, country_code)
);

-- Indexes for osm_relations
CREATE INDEX IF NOT EXISTS idx_osm_relations_relation_id ON osm_relations(relation_id);
CREATE INDEX IF NOT EXISTS idx_osm_relations_country_level ON osm_relations(country_code, admin_level);
CREATE INDEX IF NOT EXISTS idx_osm_relations_parent ON osm_relations(parent_relation_id);
CREATE INDEX IF NOT EXISTS idx_osm_relations_geom ON osm_relations USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_osm_relations_wikidata ON osm_relations(wikidata_id);

-- Progress tracking for resumable imports
CREATE TABLE IF NOT EXISTS import_progress (
  id SERIAL PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL UNIQUE,
  current_admin_level INTEGER DEFAULT 2,
  status VARCHAR(20) NOT NULL,
  relations_fetched INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  last_error TEXT
);

-- Index for import_progress lookups
CREATE INDEX IF NOT EXISTS idx_import_progress_status ON import_progress(status);
