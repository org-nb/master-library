# Handoff: Phase A (BFF) implemented

**Date:** 2026-10-04 19:45
**Scope:** plan slices A1–A8 under `app/`; Phase B not started.

## What was done

- Implemented all eight Phase A slices in `app/` per
  `.agents/plan/202610041648_bff-frontend-implementation.md`.
- Tests: 93 unit + 7 real-oxivault integration tests pass
  (`pnpm test` in `app/`); the MinIO publish round-trip test self-skips
  without MinIO and runs in CI (new workflow
  `.github/workflows/app-ci.yml`, MinIO service + aws s3api bucket
  creation).
- Gates: `biome check` clean, `svelte-check` 0 errors (1 a11y caption
  warning on the video element, accepted), `pnpm build` green, root
  `tara check` green (ruff/ty/pytest/audit).
- Container: `app/Dockerfile` builds successfully; smoke-tested
  `master-library-app:test` — entrypoint supervises SvelteKit (3000)
  and oxivault (8000 loopback); `/healthz` returns 503 "degraded"
  without S3, as designed. Full publish round-trip through the
  container is a release task.
- Docs: plan status updated with per-slice outcomes and deviations;
  README gained a "The app (Phase A: BFF)" section.

## Decisions made during implementation (beyond the plan)

- oxivault 0.2.1 requires `type`/`@type` in note frontmatter on writes
  and a `context.jsonld` at the vault root; catalog notes declare
  `type: VideoEpisode` (schema default) and the fixture vault ships a
  minimal `context.jsonld`.
- The installed `@aws-sdk/client-s3@3.1146.0` build has no
  `PutBucketCommand`; bucket creation is an operator/CI step, and the
  MinIO test verifies buckets with `HeadBucketCommand`.
- `loadConfig` collects all env problems before failing (previously
  staged, which hid most gaps); `createUsageMeter` defaults its window
  to one hour (a missing window produced NaN filtering and a silently
  disabled budget).
- Root `pyproject.toml`: `ty` override ignores `app/serve_vault.py`
  (its deps, oxivault/uvicorn, are container-local, not in the root
  venv). `serve_vault.py` is ruff-clean and runs in the container.
- `package.json` pins `packageManager: pnpm@12.4.2`; the pnpm 12
  lockfile records it, which `--frozen-lockfile` in the Dockerfile
  requires.

## Known gaps / next steps

1. Phase B (B1–B6): reader UX polish, login/editor UX, publish
   dashboard, Svelte Flow graph views, agent panels, budgets/a11y.
2. Playwright end-to-end is not wired yet (deferred to Phase B).
3. Container publish round-trip with real R2/MinIO (release task, B6).
4. The fixture vault is minimal (3 notes, 2 registries); a larger
   fixture set with generated MP4s was planned and not added.
5. TDD ordering: some modules preceded their tests within this
   session; behavior coverage now matches the plan.

## Environment notes

- Local Docker Hub pulls are partially blocked on this machine
  (node/python images available; `minio/minio` not). Use CI for
  MinIO-gated tests, or `docker compose up -d` where the registry
  works.
- `uvx --from oxivault==0.2.1 oxivault serve <dir>` is the local
  vault for dev; the container uses `serve_vault.py` (S3Store) instead
  because the 0.2.1 CLI only supports local stores.
