# Story: As a librarian, I want to upload new videos and browse the catalog

## User Story

As a **librarian**,
I want to **upload new videos through the Cloudflare Stream dashboard and
browse the resulting catalog**,
so that **new teachings become part of the Master Library without custom
tooling**.

## Background

First implementation of the D1 video catalog from
[ADR-0001](../adr/0001-use-d1-for-video-catalog.md). There is no editor UI or
editorial API yet, so the librarian works directly in the Cloudflare dashboards
for this first cut:

- Upload and metadata entry happen in the Stream dashboard. Metadata travels as
  Stream custom metadata set at upload time.
- Upload completion triggers the Stream webhook. The catalog worker verifies it
  and syncs a record into D1; new uploads import as private drafts (status
  `draft`, visibility `private`).
- Browsing happens through the D1 query interface in the Cloudflare dashboard.

Known limitation: Stream webhooks fire on processing completion or error, not on
later metadata edits. Metadata changes after upload are covered by the scheduled
reconciliation in ADR-0001 and are out of scope here.

## Acceptance Criteria

- [ ] GIVEN a librarian with access to the Stream dashboard on the dev delivery
      account, WHEN they upload a video and provide its metadata (title,
      description, language) in the Stream dashboard, THEN the verified upload
      event creates a catalog record in the D1 `videos` table with status
      `draft`, visibility `private`, and the provided metadata.
- [ ] GIVEN the same upload event is delivered more than once, WHEN the catalog
      worker processes it, THEN the existing record is updated in place
      (revision bumped) and no duplicate row is created.
- [ ] GIVEN catalog records in the D1 database, WHEN a librarian opens the D1
      query interface and runs a query against `videos`, THEN they can browse
      the uploaded videos with their metadata, status, and visibility.

## Definition of Done

- [ ] Code reviewed and approved
- [ ] Worker tests cover webhook verification and the D1 upsert; the worker gate
      (biome, vitest) and the repo gate (`tara check`) pass
- [ ] Live qualification on the dev account: a Stream UI upload creates exactly
      one D1 record and it is browsable in the D1 console
- [ ] Operating procedure for upload and browse documented in the worker docs or
      README; changelog updated if user-facing
- [ ] No secrets or local config staged; developer reviews and commits
- [ ] Acceptance criteria verified with the librarian

## Tasks

1. Apply migration `0001_catalog_initial.sql` to the dev D1 database.
2. Register the account's single Stream webhook (event scope: state changes);
   verify signature against the raw body and reject stale timestamps before any
   write, per ADR-0001.
3. Implement verified webhook ingress in the catalog worker: on an upload
   completion event, refresh current Stream state via the Stream binding and
   upsert into D1 keyed on `stream_uid` (idempotent, revision-bumped, status
   `draft`, visibility `private`).
4. Map Stream custom metadata (title, description, language) into the D1 record;
   default missing fields per the schema.
5. Write worker runtime tests: a valid payload creates one row, a replayed
   payload updates without duplication, an invalid signature is rejected.
6. Live qualification on the dev account: upload via the Stream UI, confirm the
   D1 row appears, and browse it via the D1 console.

## Out of scope

- Editor UI, editorial API, and identity provider (later stories, see ADR-0001).
- Production provisioning and deployment (ADR-0002).
- Transcripts, keyword and semantic search, related videos, and the publication
  workflow.
- Reconciliation of Stream metadata edits after upload, and Airtable data
  migration.

## Notes

- Epic: [Master Library video catalog](../epics/master-library-video-catalog.md)
- [ADR-0001: Use D1 for the video catalog](../adr/0001-use-d1-for-video-catalog.md)
- [ADR-0002: Isolate development and production delivery](../adr/0002-isolate-dev-and-prod-delivery.md)
- [Cloudflare Stream dashboard](https://dash.cloudflare.com/?to=/:account/stream)
- [Cloudflare D1 console](https://developers.cloudflare.com/d1/observability/d1-console/)
