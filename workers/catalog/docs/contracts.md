# Catalog Worker Implementation Contracts

This document specifies the operational and interface contracts for the Master Library catalog Worker (`workers/catalog`), aligning runtime behavior with [ADR-0001](../../docs/adr/0001-use-d1-for-video-catalog.md).

## 1. Storage Location Discriminators & Constraints

`storage_locations` define the provider namespaces where physical assets reside:

| Backend | Environment | Location Fields Constraint | Asset `external_id` & `entry_path` |
| --- | --- | --- | --- |
| `r2` | `dev` \| `prod` | `account_id` not null, `bucket_name` not null, `region` is null | `external_id`: immutable object key or package prefix. `entry_path`: empty for file, or relative manifest path for package. |
| `stream` | `dev` \| `prod` | `account_id` not null, `bucket_name` is null, `region` is null | `external_id`: Stream UID (`^[a-f0-9]{32}$`). `entry_path`: relative HLS/DASH manifest path. |
| `s3` | `dev` \| `prod` | `account_id` not null, `bucket_name` not null, `region` not null | `external_id`: S3 key or package prefix. `entry_path`: relative manifest path. |

## 2. Asset Integrity & Playback Eligibility

- `is_source`: Boolean flag recording master/preservation provenance.
- `playback_enabled`: Boolean flag determined by curation and automated media qualification.
- `state`: Must be one of `pending`, `processing`, `ready`, `failed`, `missing`, `deleting`, `deleted`.
- A file can be both `is_source = true` and `playback_enabled = true` (e.g. standard fast-start progressive MP4).
- Incompatible media are kept with `is_source = true`, `playback_enabled = false`, `state = 'failed'`, and `error_code = 'conversion_required'`.
- Playback selection checks `current_version_id`, verifies `playback_enabled = true`, `state = 'ready'`, `deleted_at IS NULL`, and selects according to backend priority (`r2` first).

## 3. Public vs Protected API Contracts

- `GET /api/health`: Health status reporting D1 and R2 availability.
- `GET /api/videos`: Public paginated catalog items. Returns logical videos and their published capabilities. No raw internal storage URLs or credentials leaked.
- `GET /api/videos/:id`: Details for a single published public video.
- `GET /api/search?q=...`: Bounded search over titles, descriptions, contributors, and subjects.
- `POST /api/videos/:id/playback`: Resolves playback grant for the specified protocol (`mp4`, `hls`). Fails closed if not published or no eligible ready asset.
- Protected operator routes (`POST /api/operator/*`): Restricted to authenticated operator context; fails closed when caller is unauthenticated.
