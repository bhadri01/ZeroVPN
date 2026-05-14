-- Add geo-enrichment columns to destination_ips table
-- These are populated at write time via MaxMind GeoLite2 database lookup

ALTER TABLE destination_ips
ADD COLUMN latitude DOUBLE PRECISION,
ADD COLUMN longitude DOUBLE PRECISION,
ADD COLUMN country_code VARCHAR(2),
ADD COLUMN country_name VARCHAR(255),
ADD COLUMN city_name VARCHAR(255);

-- Index for geo-based queries (heatmaps, regional filtering)
CREATE INDEX idx_destination_ips_geo
ON destination_ips (country_code, city_name, created_at DESC)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Index for country-level rollups
CREATE INDEX idx_destination_ips_country
ON destination_ips (country_code, created_at DESC)
WHERE country_code IS NOT NULL;
