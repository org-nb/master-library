# Epic: Master Library video catalog

> **Scope revision (2026-10-04):** [ADR-0003](../adr/0003-use-oxivault-on-r2-for-video-catalog.md)
> replaces the D1 catalog with an oxivault vault on R2, a Svelte UI over the
> oxivault API, direct R2 delivery and optional Stream publication. The D1
> references below are superseded; this epic will be rewritten once the
> oxivault upstream extensions (auth, CORS, presigned upload) land.

## Goal

Give librarians a working catalog of the Master Library's ~1,000 videos that
they can add to and browse without engineering help.

## Background

The library currently relies on the historical Airtable ingestion pipeline,
which is being retired. ADR-0001 selects D1 as the authoritative editorial
catalog database, with a minimal BBC Programmes profile, provider-neutral
video versions/assets, backend
synchronization and search as derived projections. This epic delivers the
first usable increment: an authorized librarian can register a video using a
small operator ingest tool, upload to private R2 and browse the result in D1.
This replaces the earlier Stream-dashboard-only workflow; it is not an editor UI.

## Scope

### In scope

- First cut: register metadata and upload to private R2 using the authenticated
  ingest tool, verify MP4 completion and browse through the D1 query interface.
- Trusted ingest validation and idempotent D1 updates, per ADR-0001.
- Register logical video, content version and R2 asset separately. Browsing
  exposes backend/location and version identity rather than a mandatory Stream
  UID on the video row.
- The dev delivery account only; production delivery is a separate ADR-0002
  story.

### Out of scope

- Editor UI and identity-provider deployment. Minimal protected ingest
  command/API contracts are in scope.
- Keyword and semantic search, transcripts, related videos, publication
  workflow.
- Production provisioning and deployment.
- Airtable data migration.
- Stream/S3 upload workflows, external transcoding and multi-backend playback
  delivery. These follow the shared model but are later increments.

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Videos an authorized librarian can add per upload | 0 (Airtable pipeline only) | 1, registered as a private draft |
| Time from verified ingest completion to catalog state update | Not measurable today | Under 5 minutes; encoding/upload duration excluded |
| Duplicate catalog rows per upload | Not measured | 0 (idempotent upsert) |

## Stories

<!-- List child stories as they are created -->
- [ ] [Upload new videos and browse the catalog](../stories/upload-and-browse-catalog.md)

Follow-up increments add protected R2 MP4 playback first, then R2 HLS
packaging, search, optional Stream and S3/CloudFront integration.
They must demonstrate one catalog video with R2 and Stream copies of the same
version, plus a different edited version, without duplicate search results.

## Dependencies

- ADR-0001 D1 catalog Worker scaffolding (in progress in `workers/catalog`).
- ADR-0001 migration from the current `videos.stream_uid` scaffold to
  `video_versions`, `video_assets` and `storage_locations`.
- Dev delivery account with private R2, D1 and the catalog Worker (ADR-0002).
- Trusted operator identity, scoped upload authorization and the ingest tool.
- D1 console access for authorized librarians.

## Open Questions

- Which trusted operator identity supplies the protected ingest command/API?
- Does the metadata-file/operator-tool workflow meet librarian needs before an
  editor UI exists?
