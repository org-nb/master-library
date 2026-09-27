# Catalog review fixes

## Changes

- Honored `videos.current_version_id` in list, detail, search, and default
  playback. Only null falls back to the first non-deleted version. Missing,
  deleted, foreign, and empty pointers fail playback; explicit version selection
  still works.
- Replaced copied migration SQL and the custom splitter with Cloudflare's
  `readD1Migrations` and `applyD1Migrations`. Tests read the deployment SQL files
  and reset migration bookkeeping when rebuilding their local database.
- Added regressions for version selection and SQL literals, comments, and
  multi-statement triggers. Updated the implementation contracts.

## Validation and handoff

- Reproduced failures before implementing the fixes.
- Worker gate passes with 35 tests; `tara check` passes.
- Changed tests pass a standalone type-check with Worker and Vitest types.
- Existing Biome `any` warnings remain. The full test-project type-check also
  has pre-existing missing runtime types and unknown-payload errors in
  `test/index.spec.ts`; these are outside this patch.
- No deployment or schema change. Remaining ADR implementation packages are
  unchanged. The developer reviews and commits.
- Suggested commit: `fix(catalog): honor current versions and use deployment SQL in tests`.
