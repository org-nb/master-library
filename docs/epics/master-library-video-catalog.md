# Epic: Master Library video catalog

## Goal

Give librarians a working catalog of the Master Library's ~1,000 videos that
they can add to and browse without engineering help.

## Background

The library currently relies on the historical Airtable ingestion pipeline,
which is being retired. ADR-0001 selects D1 as the authoritative editorial
catalog database, with Stream webhook synchronization and search as derived
projections. This epic delivers the first usable increment: a librarian can add
a new video and see it in the catalog, end to end, using only the Cloudflare
dashboards.

## Scope

### In scope

- First cut: upload a video and provide its metadata in the Cloudflare Stream
  dashboard, sync it into the D1 catalog on upload, and browse the catalog
  through the D1 query interface.
- Stream webhook verification and idempotent D1 sync, per ADR-0001.
- The dev delivery account only; production delivery is a separate ADR-0002
  story.

### Out of scope

- Editor UI, editorial API, and identity provider.
- Keyword and semantic search, transcripts, related videos, publication
  workflow.
- Production provisioning and deployment.
- Airtable data migration.

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Videos a librarian can add per upload without engineering involvement | 0 (Airtable pipeline only) | 1, synced to the catalog within minutes |
| Time from upload to record appearing in the D1 catalog | Not measurable today | Under 5 minutes (webhook + refresh) |
| Duplicate catalog rows per upload | Not measured | 0 (idempotent upsert) |

## Stories

<!-- List child stories as they are created -->
- [ ] #issue — [Upload new videos and browse the catalog](stories/upload-and-browse-catalog.md)

## Dependencies

- ADR-0001 D1 catalog Worker scaffolding (in progress in `workers/catalog`).
- Dev delivery account with Stream, D1, and the catalog Worker (ADR-0002).
- Cloudflare dashboards accessible to librarians.

## Open Questions

- Does the librarian set metadata at upload time in Stream, or edit it later?
  (First cut assumes at-upload custom metadata.)
- How do we verify live webhook behavior on the dev account before production?
