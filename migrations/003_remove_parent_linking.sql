-- Remove parent linking feature from hierarchical import
-- Parent links are not used by the main API and add unnecessary complexity

-- Drop index on parent_relation_id
DROP INDEX IF EXISTS idx_osm_relations_parent;

-- Drop parent_relation_id column
ALTER TABLE osm_relations DROP COLUMN IF EXISTS parent_relation_id;
