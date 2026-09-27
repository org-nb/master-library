-- Migration 0003_backfill_legacy_videos.sql
-- Backfills existing legacy videos into BBC profile structures:
-- 1. Creates a default Stream storage location for legacy rows
-- 2. Creates a default Version (version_number=1, 'Original Release') for every existing video
-- 3. Creates a managed Video Asset for the existing stream_uid
-- 4. Creates an HLS playback entry for that asset
-- 5. Normalizes teachers and topics into people/topics tables without inventing artificial data.

-- 1. Ensure default dev Stream location exists for legacy assets
INSERT OR IGNORE INTO storage_locations (id, backend, environment, account_id, bucket_name, region, enabled)
VALUES ('loc-stream-legacy', 'stream', 'dev', 'cf-account-legacy', NULL, NULL, 1);

-- 2. Backfill video_versions (one edition per legacy video)
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

-- 3. Backfill video_assets (one managed Stream asset per legacy video)
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

-- 4. Update preferred_asset_id on backfilled video_versions
UPDATE video_versions
SET preferred_asset_id = 'asset-' || video_id || '-stream'
WHERE preferred_asset_id IS NULL;

-- 5. Backfill asset_playback_entries for managed stream assets
INSERT OR IGNORE INTO asset_playback_entries (id, asset_id, protocol, entry_path)
SELECT
  'entry-' || id || '-stream-hls',
  'asset-' || id || '-stream',
  'hls',
  'manifest/video.m3u8'
FROM videos;

-- 6. Backfill teachers into people and video_contributors
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

-- 7. Backfill topics into topics and video_topics
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
