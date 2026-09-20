# ADR-0001: Use D1 for the video catalog

- **Status:** Proposed
- **Date:** 2026-09-20
- **Authors:** Daniel Kapitan, GitHub Copilot

## Context and Problem Statement

The catalog will replace the Airtable-oriented design as the source of truth for
editorial metadata for approximately 1,000 Cloudflare Stream videos. It needs
relational editorial records, keyword and semantic search, caption and supplied
transcript indexing, and synchronization within minutes through Stream webhooks
and reconciliation.

Which backend provides transactional editorial updates and low-latency search
without introducing a data-lake writer, analytical query engine, and file
maintenance workflow into the operational path?

The design investigation is recorded in the session plan. The historical
[Airtable control-plane design](../../.agents/design/2026-06-07-airtable-control-plane-design.md)
defines the domain relationships retained by this decision.

## Decision Drivers

- Preserve relational integrity among videos, teaching works, teachers, topics,
  annotations, assets, transcripts, and editorial publication state.
- Serve filtered keyword search and maintain semantic-search projections.
- Apply frequent, small, idempotent updates from Stream synchronization.
- Keep editorial truth separate from Stream delivery metadata.
- Support a small initial catalog without prematurely operating a data lake.
- Retain a future path for large analytical workloads and external query engines.

## Considered Options

1. **D1 as the authoritative relational database, with R2 and Vectorize
   projections.** D1 holds editorial data and normalized Stream metadata. Private
   R2 stores complete transcript source files. D1 FTS5 provides keyword retrieval;
   Workers AI and Vectorize provide semantic retrieval.
2. **R2 Data Catalog as the primary database.** Apache Iceberg tables in R2,
   queried through R2 SQL or compatible external engines, hold both editorial and
   Stream metadata.
3. **Retain Airtable as editorial truth and mirror it to a search database.**
   Automation writes Stream state to Airtable and a separate database serves search.

## Decision Outcome

Chosen option: **D1 as the authoritative catalog database**, with ordinary R2 for
private transcript files and derived Vectorize/FTS projections, because it best
fits relational editorial updates and search at the expected scale.

D1 provides SQLite semantics, direct Worker bindings, transactional statement
batches, FTS5, JSON functions, and constraints. Its per-database serialized
execution is acceptable for this catalog only if synchronization writes are
change-sensitive and indexed queries stay fast.

R2 Data Catalog is not selected for the operational catalog. It is an Apache
Iceberg catalog for analytical workloads and needs an Iceberg writer and
analytical query engine. Its open format and multi-engine interoperability make
it a viable future sink for historical sync events, analytics, or offline
recommendation experiments, not the initial request-serving backend.

Airtable is not retained as an authoritative source. Editorial writes move to an
authenticated application API. This ADR does not define the editor UI or identity
provider.

### Consequences

- Good: foreign keys, constraints, revision fields, and D1 transactions protect
  editorial relationships and make duplicate queue delivery convergent.
- Good: D1 FTS5 supports keyword search without introducing a second search
  product, while Vectorize remains a rebuildable semantic projection.
- Good: complete transcript source files stay private and inexpensive in R2 rather
  than inflating application rows.
- Good: D1 permits Stream-owned data and curator-owned data to have separate
  ownership boundaries in the same transactional record model.
- Bad: D1 is not a data lake. Large analytical scans, event history, and advanced
  offline recommendation work may require a future R2 Data Catalog export.
- Bad: each D1 database processes queries serially. Slow or unindexed queries can
  reduce throughput and overload the database.
- Bad: FTS5 and Vectorize must be maintained as derived indexes. Their updates are
  not automatically atomic with D1 and require versioned, retryable outbox jobs.
- Bad: D1 has a 2 MB row limit. Large transcripts and unbounded Stream payloads
  cannot be stored as one row.
- Bad: the database and bindings are Cloudflare services. Exports, migrations and
  rebuild procedures are required to reduce provider-lock-in risk.

## Architecture

```text
Cloudflare Stream webhook
  -> verified ingress -> sync queue -> Stream refresh -> D1

Scheduled reconciliation
  -> complete inventory plus captions -> sync queue -> D1

Editorial API
  -> D1 transaction: editorial record plus indexing outbox

Transcript import
  -> private R2 source file -> D1 searchable chunks -> FTS5

Indexing queue
  -> Workers AI embeddings -> Vectorize

Search API
  -> D1 FTS5 and Vectorize candidates -> D1 access/revision check -> result
```

Use TypeScript Workers to access D1, R2, Queues, Vectorize, Workers AI, and
the Stream Worker binding. TypeScript is chosen for direct platform integration,
generated binding types, and Workers runtime testing. It is not selected on an
unverified claim of material performance superiority over Python.

The logical schema includes:

- `videos` for editorial title, description, language, publication status,
  visibility, revisions, and soft deletion.
- `stream_videos` for a Stream UID projection: processing state, readiness,
  duration, playback references, custom metadata, source timestamps and snapshot
  hash.
- Teaching works, teachers, topics, annotations, assets, and relationship tables.
- Transcript, search-document, FTS5, index-state, synchronization-job, and
  transactional outbox tables.

Application video IDs are independent of Stream UIDs. Stream updates must never
overwrite editorial title, visibility, notes, or publication state. New Stream
videos import as private drafts. FTS5 and Vectorize are derived projections and
must not authorize a result on their own.

### Synchronization Boundaries

Stream webhooks report video processing completion or error. They do not provide
complete coverage of Stream metadata edits, caption changes, or deletions.
Verified webhooks trigger a refresh of current Stream state; they are not treated
as complete state replacements.

The Worker verifies the signature against the raw request body and rejects stale
timestamps. It awaits Queue acceptance before returning success. Queues provide
at-least-once delivery, so consumers use deterministic job keys, D1 revisions,
fenced leases and idempotent upserts.

Every five minutes, reconciliation enumerates Stream records and captions. A
successful complete inventory is required before an absent Stream UID is
tombstoned. Timeouts, permissions errors, throttling, or partial enumeration
cannot delete catalog records. Known videos receive direct refreshes to detect
metadata edits that creation-time listing cannot identify.

The Stream list API returns at most 1,000 videos, exactly the initial catalog
target. The implementation must prove cursor/window boundary behavior,
same-timestamp handling, count coverage and non-progress detection before
relying on reconciliation to declare a complete inventory.

### Search and Access Boundaries

Existing Stream caption tracks and supplied transcripts are imported. Complete
source files remain private in R2; bounded chunks retain language, provenance,
content hash, revision, and available time offsets in D1. Missing, malformed,
in-progress and failed transcripts are reported, not silently replaced or
automatically generated.

Search combines D1 FTS5 and Vectorize candidates. Before a result, passage, count
or playback reference is returned, D1 verifies that its current revision is
published, visible to the caller, non-deleted and playable. Private notes never
enter derived search documents. Until an identity adapter exists, external
editorial writes and restricted reads fail closed.

## Rollout

1. Verify the installed Wrangler schema and generated types, Stream binding
   behavior, caption retrieval, list-window semantics, FTS5 support, embedding
   model dimensions, corpus languages, costs, and whether existing Airtable data
   needs a one-way import.
2. Scaffold a modular TypeScript Worker with generated bindings, D1 migrations,
   structured logs, traces, and Workers runtime tests.
3. Implement editorial D1 contracts and the transactional indexing outbox before
   accepting external writes.
4. Bootstrap existing Stream videos, then implement verified webhook handling,
   reconciliation, retries, dead-letter handling, and safe tombstones.
5. Add transcript import, FTS5 search, semantic indexing, hybrid ranking and
   non-personalized related-video results.
6. Validate with synthetic fixtures and an authorized staging smoke test before
   provisioning production resources, registering the account's single Stream
   webhook, migrating data, or deploying.

## References

- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [D1 SQL statements and FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 Data Catalog](https://developers.cloudflare.com/r2-data-catalog/)
- [R2 Data Catalog pricing](https://developers.cloudflare.com/r2-data-catalog/platform/pricing/)
- [R2 SQL](https://developers.cloudflare.com/r2-sql/)
- [Stream webhooks](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/)
- [Stream Worker binding](https://developers.cloudflare.com/stream/manage-video-library/bindings/)
- [Stream list API](https://developers.cloudflare.com/api/resources/stream/methods/list/)
- [Stream captions](https://developers.cloudflare.com/stream/edit-videos/adding-captions/)
- [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Vectorize API](https://developers.cloudflare.com/vectorize/reference/client-api/)
