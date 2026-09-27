-- Migration 0002_catalog_bbc_profile.sql
-- Additive migration implementing the BBC Programmes ontology profile and multi-backend assets.

-- Add series_id and position to videos table
ALTER TABLE videos ADD COLUMN series_id TEXT REFERENCES series(id);
ALTER TABLE videos ADD COLUMN position INTEGER CHECK(position IS NULL OR position > 0);
ALTER TABLE videos ADD COLUMN current_version_id TEXT;
ALTER TABLE videos ADD COLUMN deleted_at TEXT;

-- 1. Series (po:Series)
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

-- 2. People (foaf:Person)
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

-- 3. Video Contributors (po:credit)
CREATE TABLE IF NOT EXISTS video_contributors (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK(role IN ('teacher', 'speaker', 'translator', 'interviewer', 'contributor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(video_id, person_id, role)
);

-- 4. Topics (po:Subject)
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

-- 5. Video Topics (po:subject)
CREATE TABLE IF NOT EXISTS video_topics (
  video_id TEXT NOT NULL REFERENCES videos(id),
  topic_id TEXT NOT NULL REFERENCES topics(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (video_id, topic_id)
);

-- 6. Storage Locations (Local provider namespaces)
CREATE TABLE IF NOT EXISTS storage_locations (
  id TEXT PRIMARY KEY,
  backend TEXT NOT NULL CHECK(backend IN ('r2', 'stream', 's3')),
  environment TEXT NOT NULL CHECK(environment IN ('dev', 'prod')),
  account_id TEXT NOT NULL,
  bucket_name TEXT,
  region TEXT,
  delivery_profile_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (backend = 'r2' AND bucket_name IS NOT NULL AND region IS NULL) OR
    (backend = 'stream' AND bucket_name IS NULL AND region IS NULL) OR
    (backend = 's3' AND bucket_name IS NOT NULL AND region IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_locations_r2_s3
  ON storage_locations(backend, environment, account_id, bucket_name)
  WHERE bucket_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_locations_stream
  ON storage_locations(backend, environment, account_id)
  WHERE backend = 'stream';

-- 7. Video Versions (po:Version)
CREATE TABLE IF NOT EXISTS video_versions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  label TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  duration_seconds INTEGER CHECK(duration_seconds IS NULL OR duration_seconds >= 0),
  revision INTEGER NOT NULL DEFAULT 1,
  preferred_asset_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(video_id, version_number)
);

-- 8. Video Assets (Physical / managed backend copies)
CREATE TABLE IF NOT EXISTS video_assets (
  id TEXT PRIMARY KEY,
  video_version_id TEXT NOT NULL REFERENCES video_versions(id),
  location_id TEXT NOT NULL REFERENCES storage_locations(id),
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('file', 'package', 'managed')),
  is_source INTEGER NOT NULL DEFAULT 0 CHECK(is_source IN (0, 1)),
  state TEXT NOT NULL CHECK(state IN ('pending', 'processing', 'ready', 'failed', 'missing', 'deleting', 'deleted')),
  playback_enabled INTEGER NOT NULL DEFAULT 0 CHECK(playback_enabled IN (0, 1)),
  derived_from_asset_id TEXT REFERENCES video_assets(id),
  profile TEXT,
  byte_size INTEGER CHECK(byte_size IS NULL OR byte_size >= 0),
  sha256 TEXT,
  provider_version_id TEXT,
  etag TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  snapshot_hash TEXT,
  last_seen_at TEXT,
  verified_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(location_id, external_id)
);

-- 9. Asset Playback Entries (Playable entrypoints per protocol)
CREATE TABLE IF NOT EXISTS asset_playback_entries (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES video_assets(id),
  protocol TEXT NOT NULL CHECK(protocol IN ('mp4', 'hls', 'dash')),
  entry_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, protocol)
);

-- Indexes for performance and foreign lookups
CREATE INDEX IF NOT EXISTS idx_video_contributors_person ON video_contributors(person_id);
CREATE INDEX IF NOT EXISTS idx_video_topics_topic ON video_topics(topic_id);
CREATE INDEX IF NOT EXISTS idx_video_versions_video ON video_versions(video_id, version_number);
CREATE INDEX IF NOT EXISTS idx_video_assets_version ON video_assets(video_version_id, state, playback_enabled);
CREATE INDEX IF NOT EXISTS idx_asset_playback_entries_asset ON asset_playback_entries(asset_id, protocol);
