# Airtable Control Plane Design

**Project:** Master Library
**Date:** 2026-06-07
**Status:** Approved in chat

## Goal

Define the Airtable schema for the librarian-facing control plane, with `Videos` as the primary editorial record and supporting tables for grouped teachings, annotations, assets, and teachers.

## Table Architecture

Use five primary Airtable tables:

1. `Videos`
2. `TeachingWorks`
3. `Annotations`
4. `Assets`
5. `Teachers`

Optional later tables:

- `Topics`
- `Collections`
- `SyncJobs`

### Relationships

- One `Video` can belong to zero or one `TeachingWork`
- One `TeachingWork` can group many `Videos`
- One `Video` can have many `Annotations`
- One `Video` can have many `Assets`
- One `Video` can link to one or more `Teachers`
- One `TeachingWork` can also link to one or more `Teachers`

### Table Purposes

#### `Videos`

Primary librarian workspace. Owns canonical editorial metadata, operational visibility fields, and core Cloudflare playback/reference fields.

#### `TeachingWorks`

Series/container records for retreats, courses, or grouped teaching contexts. Adds shared context without taking over the primary editorial role.

#### `Annotations`

Timestamped notes, excerpts, topical segments, and indexing-ready text linked to a `Video`.

#### `Assets`

Source files, transcripts, captions, and related artifacts linked to a `Video`.

#### `Teachers`

Canonical person records used to normalize attribution across the catalog.

## Field Model

### `Videos`

#### Editorial

- `Title`
- `Slug`
- `Description`
- `Teaching Date`
- `Language`
- `Publication Status`
- `Visibility`
- `Notes`

#### Relationships

- linked `TeachingWork`
- linked `Teachers`
- linked `Annotations`
- linked `Assets`

#### Delivery and Status Visibility

- `Cloudflare UID`
- `Cloudflare Iframe URL`
- `Cloudflare HLS URL`
- `Cloudflare Thumbnail URL`
- `Stream State`
- `Ready to Stream`
- `Duration Seconds`

#### Search and Sync Visibility

- `Meilisearch Document ID`
- `Last Indexed At`
- `Sync Status`
- `Last Sync Error`

### `TeachingWorks`

- `Title`
- `Slug`
- `Description`
- `Type`
- linked `Teachers`
- linked `Videos`

### `Annotations`

- linked `Video`
- `Start Seconds`
- `End Seconds`
- `Text`
- `Topic`
- `Type`
- optional `Visibility` or `Publishable`

### `Assets`

- linked `Video`
- `Asset Type`
- `S3 Bucket`
- `S3 Key`
- `Checksum / ETag`
- `Mime Type`
- `Status`
- `Notes`

### `Teachers`

- `Display Name`
- `Slug`
- `Alternate Names`
- `Bio`
- linked `Videos`
- linked `TeachingWorks`

## Workflow And Data Flow

1. Librarian creates or updates a `Video`
2. Supporting artifacts are linked through `Assets`
3. External services process S3, Cloudflare Stream, and Meilisearch operations
4. Operational status and reference fields are written back onto `Video`
5. Librarians monitor readiness in Airtable
6. Timestamped notes and excerpts are stored in `Annotations`

The key boundary is:

- Librarians edit editorial truth in `Videos`, `TeachingWorks`, `Annotations`, and sometimes `Teachers`
- Automation updates operational fields such as sync state, Stream identifiers, and indexing timestamps

For the MVP, Airtable should expose visibility rather than low-level control:

- show `Sync Status`
- show `Last Sync Error`
- show `Ready to Stream`
- show indexing freshness
- avoid publish/retry buttons until workflows are proven

## Error Handling

- `Videos.Sync Status` should use a controlled set such as `draft`, `ready_for_ingest`, `ingesting`, `processing`, `ready`, `indexing`, `error`
- `Videos.Last Sync Error` should contain a short human-readable summary
- `Assets.Status` should show file-level issues separately from video-level publication issues
- Librarians correct editorial inputs; automation updates operational fields

## Testing Strategy

- Schema tests for required tables and links
- Normalization tests for Airtable-to-Python mapping
- Sync tests for status transitions and write-backs
- Failure tests for file, Stream, and indexing errors
- Contract tests for downstream field completeness

## Success Criterion

A librarian should be able to open a `Video` record and quickly tell whether it is editorially complete, operationally healthy, and ready for publication.
