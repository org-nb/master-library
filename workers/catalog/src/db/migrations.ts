export const migration0001 = `
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  stream_uid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  teacher TEXT,
  topic TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL CHECK(status IN ('draft', 'ready', 'published', 'archived')),
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
  revision INTEGER NOT NULL DEFAULT 1,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transcript_sources (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  source_type TEXT NOT NULL CHECK(source_type IN ('caption', 'vtt', 'plain-text')),
  language TEXT NOT NULL,
  content_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'ready', 'failed', 'missing')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_videos_status_visibility
  ON videos(status, visibility, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_videos_title
  ON videos(title);

CREATE INDEX IF NOT EXISTS idx_transcript_sources_video
  ON transcript_sources(video_id, status);
`

export const migration0002 = `
ALTER TABLE videos ADD COLUMN series_id TEXT REFERENCES series(id);
ALTER TABLE videos ADD COLUMN position INTEGER CHECK(position IS NULL OR position > 0);
ALTER TABLE videos ADD COLUMN current_version_id TEXT;
ALTER TABLE videos ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS video_contributors (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK(role IN ('teacher', 'speaker', 'translator', 'interviewer', 'contributor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(video_id, person_id, role)
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS video_topics (
  video_id TEXT NOT NULL REFERENCES videos(id),
  topic_id TEXT NOT NULL REFERENCES topics(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (video_id, topic_id)
);

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

CREATE TABLE IF NOT EXISTS asset_playback_entries (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES video_assets(id),
  protocol TEXT NOT NULL CHECK(protocol IN ('mp4', 'hls', 'dash')),
  entry_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, protocol)
);
`

export const migration0003 = `
INSERT OR IGNORE INTO storage_locations (id, backend, environment, account_id, bucket_name, region, enabled)
VALUES ('loc-stream-legacy', 'stream', 'dev', 'cf-account-legacy', NULL, NULL, 1);

INSERT OR IGNORE INTO video_versions (id, video_id, version_number, label, language, duration_seconds, revision)
SELECT
  'ver-' || id || '-v1',
  id,
  1,
  'Original Release',
  language,
  duration_seconds,
  1
FROM videos;

INSERT OR IGNORE INTO video_assets (
  id,
  video_version_id,
  location_id,
  external_id,
  kind,
  is_source,
  state,
  playback_enabled,
  created_at
)
SELECT
  'asset-' || id || '-stream',
  'ver-' || id || '-v1',
  'loc-stream-legacy',
  stream_uid,
  'managed',
  0,
  CASE WHEN status = 'published' THEN 'ready' ELSE 'pending' END,
  CASE WHEN status = 'published' AND visibility = 'public' THEN 1 ELSE 0 END,
  updated_at
FROM videos;

UPDATE video_versions
SET preferred_asset_id = 'asset-' || video_id || '-stream'
WHERE preferred_asset_id IS NULL;

INSERT OR IGNORE INTO asset_playback_entries (id, asset_id, protocol, entry_path)
SELECT
  'entry-' || id || '-stream-hls',
  'asset-' || id || '-stream',
  'hls',
  'manifest/video.m3u8'
FROM videos;

INSERT OR IGNORE INTO people (id, display_name)
SELECT
  'person-' || lower(hex(teacher)),
  teacher
FROM videos
WHERE teacher IS NOT NULL AND trim(teacher) != '';

INSERT OR IGNORE INTO video_contributors (id, video_id, person_id, role)
SELECT
  'contrib-' || v.id || '-' || p.id,
  v.id,
  p.id,
  'teacher'
FROM videos v
JOIN people p ON p.display_name = v.teacher
WHERE v.teacher IS NOT NULL AND trim(v.teacher) != '';

INSERT OR IGNORE INTO topics (id, label)
SELECT
  'topic-' || lower(hex(topic)),
  topic
FROM videos
WHERE topic IS NOT NULL AND trim(topic) != '';

INSERT OR IGNORE INTO video_topics (video_id, topic_id)
SELECT
  v.id,
  t.id
FROM videos v
JOIN topics t ON t.label = v.topic
WHERE v.topic IS NOT NULL AND trim(v.topic) != '';
`
