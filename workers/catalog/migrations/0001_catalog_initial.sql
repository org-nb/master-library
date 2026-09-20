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
