# Handoff: Implemented P0, P1, P2 and Baseline Resolver for ADR-0001

Date: 2026-09-27 10:46 CEST
Branch: `adr-0001-multi-backend`

## What Was Done

1. **P0: Pinned Minimal BBC Programmes Profile and Contracts**
   - Authored `workers/catalog/docs/catalog-profile.md` with explicit mappings for `po:Episode` (`videos`), `po:Series` (`series`), `po:Version` (`video_versions`), `foaf:Person` (`people`), `po:credit` (`video_contributors`), and `po:Subject` (`topics` / `video_topics`), keeping physical storage as a local extension.
   - Authored `workers/catalog/docs/contracts.md` defining storage location constraints across R2, Stream, and S3, independent `is_source`/`playback_enabled` flags, and API boundaries.
   - Added `workers/catalog/test/fixtures/catalog-profile.json` and verification tests in `workers/catalog/test/profile.spec.ts`.

2. **P1: Runtime and Environment Boundaries & Tooling**
   - Added Biome (`biome.json`) configured according to project rules, replacing `.prettierrc`.
   - Updated `workers/catalog/package.json` scripts: `lint`, `format`, `typecheck`, and `check`.
   - Implemented `src/config.ts` for typed runtime environment configuration.

3. **P2: Additive D1 Migrations and Backfill**
   - Added `0002_catalog_bbc_profile.sql` introducing `series`, `people`, `video_contributors`, `topics`, `video_topics`, `storage_locations`, `video_versions`, `video_assets`, and `asset_playback_entries`.
   - Added `0003_backfill_legacy_videos.sql` to backfill existing legacy video records into initial `video_versions` (edition 1) and managed Stream `video_assets` without data loss or inventing artificial durations.
   - Added automated migration runner and tests in `workers/catalog/test/migrations.spec.ts`.

4. **P3/P6: D1 Repository, Playback Resolver, and Worker Entrypoint**
   - Created `src/types.ts` defining domain interfaces.
   - Implemented `src/db/repository.ts` (`D1CatalogRepository`) supporting queries enriched with BBC entities and multi-backend assets.
   - Implemented `src/playback.ts` (`PlaybackResolver`) prioritizing R2 MP4 grants with signed media tokens, supporting Stream HLS, and failing closed on drafts or missing protocol assets.
   - Implemented `src/app.ts` providing Hono routing (`/api/health`, `/api/videos`, `/api/videos/:id`, `/api/search`, `/api/videos/:id/playback`) with full test coverage (`test/app.spec.ts`).

## Verification
- `pnpm --dir workers/catalog run check` passes all 25 tests, Biome linting, and TypeScript compilation.
- Python gate (`pytest`, `ruff`, `ty`) passes completely.
