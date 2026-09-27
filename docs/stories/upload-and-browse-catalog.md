# Story: As a librarian, I want to upload new videos and browse the catalog

## User Story

As a **librarian**,
I want to **register video metadata, upload to private R2 and browse its catalog
record**, so that new teachings can be added through a repeatable ingest process.

## Background

First ingestion slice of [ADR-0001](../adr/0001-use-d1-for-video-catalog.md).
R2 is the default, not Stream. This replaces the earlier Stream-dashboard-only
workflow with a small authenticated operator ingest tool; no editor UI is required.

The tool accepts a video and validated metadata, reserves IDs through the
protected catalog command/API, and transfers bytes directly to R2. A trusted
media probe/completion job verifies the file and updates D1. Browse through the
D1 console initially. Direct bucket upload alone is not complete registration.

The minimal BBC profile maps the teaching to `po:Episode`, its content edition
to `po:Version`, and an optional recording series to `po:Series`. R2 files are
local assets, not extra episodes/versions. Contributor and topic IDs are
separate from provider metadata.

## Acceptance Criteria

- [ ] GIVEN an authorized operator and valid metadata, WHEN they run the ingest
      tool without specifying a backend, THEN it reserves one private draft
      video, edition 1 and asset at the configured R2 location, with no Stream
      UID or Stream/AWS credentials.
- [ ] GIVEN a large file, WHEN upload is interrupted and resumed, THEN the
      same ingest job continues without duplicate catalog rows or overwriting
      another completed asset.
- [ ] GIVEN a valid H.264/AAC MP4 and authenticated probe report, WHEN completion
      verifies object identity, size/checksum and media properties, THEN the
      asset becomes ready, `is_source=true` and `playback_enabled=true`.
      The video remains a private draft; readiness does not publish it.
- [ ] GIVEN an unsupported or incomplete upload, WHEN validation runs, THEN
      the asset stays non-playable with an explicit conversion/failure reason.
- [ ] GIVEN a duplicate completion/event, WHEN it is processed, THEN unchanged
      state creates no rows and bumps no revisions.
- [ ] GIVEN catalog records, WHEN the librarian runs the ADR's D1 browse join,
      THEN metadata, edition, backend/location, processing state, source and
      playback flags are visible.
- [ ] GIVEN an unauthenticated completion request or arbitrary object event,
      WHEN it reaches ingest, THEN it cannot mark a file ready or overwrite
      curator metadata.

## Definition of Done

- [ ] Worker/runtime tests cover registration, real D1 constraints, upload
      completion and idempotency; Biome, types, Vitest and `tara check` pass
- [ ] Complete legacy-schema migration rehearsed before R2-only records
- [ ] Authorized dev qualification uses the ingest tool and private R2 with
      exactly one video, edition and asset visible in the D1 join
- [ ] Ingest metadata example, resume/failure procedure and browse query documented
- [ ] No credentials/local configuration staged; developer reviews and commits
- [ ] Librarian reviews the operator-tool workflow and acceptance evidence

## Tasks

1. Implement and rehearse the BBC-profile schema, legacy backfill and removal
   of mandatory `stream_uid`. Do not rewrite applied migration `0001`.
2. Add the protected registration/completion contract and operator tool with
   validated metadata, server-selected R2 location and deterministic job IDs.
3. Support scoped direct multipart/resumable upload and trusted ffprobe-based
   validation bound to uploaded bytes. Finalize immutable objects before readiness.
4. Implement completion/reconciliation with idempotent state updates and
   explicit failure reasons. No Stream webhook is required.
5. Test valid, unsupported, partial, unauthorized and replayed uploads locally,
   then perform the separately approved dev qualification.

## Out of scope

- Full editor UI and identity-provider deployment; a trusted operator identity
  is nevertheless required before activating the protected ingest API
- Viewer playback and publication workflow, delivered immediately after this
  story by implementation-plan P6
- Adaptive transcoding/packaging, Stream/S3 adapters and cross-provider copying
- Transcript/search implementation, bulk Airtable import and production deployment

## References

- [Epic](../epics/master-library-video-catalog.md)
- [ADR-0001 implementation plan](../../.agents/plan/202609270916_adr-0001-multi-backend-implementation.md)
- [ADR-0002](../adr/0002-isolate-dev-and-prod-delivery.md)
- [Cloudflare D1 console](https://developers.cloudflare.com/d1/observability/d1-console/)
