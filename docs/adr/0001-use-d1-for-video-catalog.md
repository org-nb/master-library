# ADR-0001: Use D1 for the video catalog

- **Status:** Proposed
- **Date:** 2026-09-20
- **Updated:** 2026-09-27: R2-first ingestion and a minimal BBC ontology profile
- **Authors:** Daniel Kapitan, GitHub Copilot

## Context and Problem Statement

The catalog will replace the Airtable-oriented design as the source of truth for
editorial metadata for approximately 1,000 videos. R2 is the first and default
ingestion/storage backend; Cloudflare Stream and AWS S3 are optional backends.
The existing code is Stream-oriented, but that is a migration constraint, not
the desired ingest order. The catalog needs
relational editorial records, keyword and semantic search, caption and supplied
transcript indexing, and synchronization through verified ingest completion,
reconciliation and optional Stream webhooks. A video can have several content
versions and several backend copies of each version without becoming duplicate
catalog entries.

Which backend provides transactional editorial updates and low-latency search
without introducing a data-lake writer, analytical query engine, and file
maintenance workflow into the operational path?

The design investigation is recorded in the session plan. The historical
[Airtable control-plane design](../../.agents/design/2026-06-07-airtable-control-plane-design.md)
provides historical domain requirements. The BBC profile below refines those
relationships without retaining the Airtable schema as an ontology.

## Decision Drivers

- Preserve relational integrity among videos, series, contributors, topics,
  annotations, assets, transcripts, and editorial publication state.
- Serve filtered keyword search and maintain semantic-search projections.
- Apply frequent, small, idempotent updates from backend synchronization.
- Keep editorial truth separate from provider-owned delivery metadata.
- Identify equivalent copies across R2, Stream and S3 while distinguishing
  different edits, languages and timelines.
- Select a playable copy without coupling catalog IDs or access rules to a provider.
- Reuse an existing editorial ontology without introducing a graph database,
  production-management model or generic metadata framework.
- Deliver a usable R2 ingest/browse/playback slice before optional integrations.
- Support a small initial catalog without prematurely operating a data lake.
- Retain a future path for large analytical workloads and external query engines.

## Considered Options

1. **D1 as the authoritative relational database, with R2 and Vectorize
   projections.** D1 holds editorial data and normalized backend metadata. Private
   R2 stores complete transcript source files. D1 FTS5 provides keyword retrieval;
   Workers AI and Vectorize provide semantic retrieval.
2. **R2 Data Catalog as the primary database.** Apache Iceberg tables in R2,
   queried through R2 SQL or compatible external engines, hold both editorial and
   Stream metadata.
3. **Retain Airtable as editorial truth and mirror it to a search database.**
   Automation writes Stream state to Airtable and a separate database serves search.

## Decision Outcome

Chosen option: **D1 as the authoritative catalog database**, a minimal BBC
Programmes ontology profile for editorial identity, and private R2 for default
video ingest and separate transcript source storage. Vectorize/FTS are derived
projections. This fits relational editorial updates and search at the expected
scale.

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
- Good: D1 permits provider-owned data and curator-owned data to have separate
  ownership boundaries in the same transactional record model.
- Good: video/version IDs survive a provider move. Several backend copies can
  coexist, with per-version delivery selection and explicit provenance.
- Bad: R2 and S3 need an encoding/packaging pipeline and media authorization
  layer; a common catalog interface does not make them managed video services.
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
Default ingest: metadata + reserved IDs -> private R2 -> verified completion
  -> sync queue -> media validation -> D1 private draft / ready asset

Optional Stream webhook / S3 ingest completion
  -> verified ingress -> sync queue -> provider refresh/validation -> D1

Scheduled reconciliation
  -> per-location inventory plus captions -> sync queue -> D1

Editorial API
  -> D1 transaction: editorial record plus indexing outbox

Transcript import
  -> private R2 source file -> D1 searchable chunks -> FTS5

Indexing queue
  -> Workers AI embeddings -> Vectorize

Search API
  -> D1 FTS5 and Vectorize candidates -> D1 access/revision check -> result

Playback API
  -> D1 video + version + eligible asset -> provider adapter -> playback grant
      -> authorized media Worker -> private R2
      -> Stream signed HLS/DASH (optional)
      -> CloudFront signed cookies -> private S3 with origin access control
```

Use TypeScript Workers to access D1, R2 and Queues first; add Vectorize,
Workers AI and the Stream binding when their increments are enabled.
TypeScript is chosen for direct platform integration,
generated binding types, and Workers runtime testing. It is not selected on an
unverified claim of material performance superiority over Python.

### Backend decision

Support `r2`, `stream` and `s3` per asset, not one backend per catalog.
**R2 is the default for new ingest and the first delivery implementation.**
No Stream library, webhook, token or AWS resource is required to ingest,
browse or play the initial R2 catalog. A configured default R2 location is
selected server-side; another backend requires an explicit enabled profile.
R2 and S3 can store an original, progressive MP4 or a validated HLS/DASH package.
Only assets with verified playback capabilities may serve a playback request.
Stream handles its own encoding and packaging; object storage does not.

Start with validated H.264/AAC progressive MP4 and byte-range playback.
Incompatible originals are retained privately but reported as requiring
conversion, never labeled playable from their extension/MIME type alone.
Use ffprobe/FFmpeg in the operator-side ingest tool, not a request-serving
Worker. Conversion/remuxing creates a separate immutable asset when needed.
Adaptive HLS packaging is the next media increment; DASH is advertised only
after its own validation. MP4-first is intentionally simpler, not a claim of
adaptive playback or a replacement for later multi-bitrate delivery.

The first ingest tool accepts video plus validated metadata, reserves IDs
through a protected catalog command/API and transfers bytes directly to R2
using scoped upload authorization. Multipart/resume is required for large
files. A trusted completion/validation job verifies the uploaded identity,
size/checksum and media report before readiness. Do not trust an arbitrary
browser's completion flag. Browsing can use the D1 console initially; the
change from the old Stream-dashboard-only story requires this small ingest
tool, not a new editor UI.

Use the [cost and functional comparison](../Cloudflare%20R2%20vs.%20Stream.md)
when selecting a preferred copy. Its 100-hour library/1,000-hour delivery
example estimates $90/month for Stream, $7.18 for R2 plus a dedicated Worker
plan, and $3.72 for S3 plus unused CloudFront allowances. These are media
subtotals, not total operating costs; encoding, shared allowances and viewer
geography can change the decision. S3 direct egress is a separate $70.16
baseline, not a substitute for pricing the CDN-backed solution.

### Ontology decision: a small BBC Programmes profile

**Choose BBC Programmes (`po:`), not MovieLabs OMC, for this catalog.**
This library describes completed teachings, their editions, grouping, speakers
and subjects. It does not manage film production, shots, props or departmental
asset exchanges. Evaluation is based on the official sources checked on
2026-09-27, not the size or popularity of either vocabulary.

| Criterion | BBC ontologies | MovieLabs OMC |
| --- | --- | --- |
| Catalog fit | Programmes provides Episode, Series, Version, subjects and credits; Version explicitly has a timeline | Creative Works covers works/edits; OMC specializes in the production process and asset exchange |
| Versions/copies | Episode -> Version fits editorial editions; provider copies need a local extension | Rich distinctions among revision, variant, derivation, representation and alternative; good for production asset management |
| Implementation weight | A small relational profile suffices; ignore broadcasting/service machinery | Can be subsetted and has JSON Schema, but Asset/AssetSC and functional/structural distinctions add concepts we do not need |
| Maintenance and reuse | IPTC-hosted BBC snapshot; `po` declares 1.1, many properties marked testing; not a promise of current BBC support | Repository supplies OMC JSON/RDF 2.8 and Apache-2.0 licensing; distribution ontology is marked pre-release |
| Decision | Best fit for a small audience-facing teaching catalog | Revisit if production-workflow or OMC partner interchange becomes a concrete requirement |

Use the actual Programmes namespace `http://purl.org/ontology/po/`, not
invented `bbc:Video` or `po:Encoding` terms. Do not base the profile on the
deprecated `cwork:Programme`, `cwork:Episode` and `cwork:Clip` classes in the
BBC Creative Work ontology. Its broad metadata model is useful context, but
adding it alongside Programmes would duplicate concepts here.

This is a **relational application profile**, not full RDF/OWL conformance.
Keep readable SQL names and a small, versioned mapping document with the
referenced term URIs and source versions. Use ordinary SQL/typed validation.
No triplestore, SPARQL, inference, generic entity/edge table, runtime ontology
downloads or mandatory JSON-LD export. An interchange projection can be added
when there is a consumer; local delivery state must not be misrepresented as
BBC terms.

| Catalog concept | Vocabulary mapping | Minimal relational shape |
| --- | --- | --- |
| Complete teaching video | `po:Episode` (also a `po:ProgrammeItem`) | Existing `videos`; a standalone item need not have a series |
| Course/retreat recording series | `po:Series`, containing episodes via `po:episode` | `series(id, title, description)` and optional `videos.series_id`, `position` |
| Content edition | `po:Version`; video -> edition is `po:version` | `video_versions`; one parent video, one timeline |
| Title and synopsis | `dcterms:title`, `po:synopsis` | Existing `title`, `description`; no duplicate generic CreativeWork row |
| Teacher/speaker | `foaf:Person`; generic programme credit is `po:credit` | `people(id, display_name)` and `video_contributors(video_id, person_id, role)` |
| Subject/topic | `po:Subject`, linked by `po:subject` | `topics(id, label)` and `video_topics(video_id, topic_id)` |
| Timing | `po:Version` timeline semantics; `po:duration` for seconds | Edition duration and local annotation/transcript start/end offsets |
| Backend copy/package and locator | Local extension, no equivalent asserted | `video_assets`, `storage_locations`, optional protocol entries |

Role values such as `teacher`, `translator` and `speaker` are local controlled
values; a teacher is not automatically an author or a person the video is
about. Contributors and subjects are distinct relationships. Use unique
`(video_id, person_id, role)` and `(video_id, topic_id)` links. Keep one optional
series per video and positive position unique within that series. Do not add
brands, seasons, nested collections or a second `teaching_works` container.
A retreat recording series is not the same entity as the physical retreat event.

Keep language codes, publication/visibility rules, technical hashes, preferred
asset, sync state and access grants as documented local fields. Timed notes are
local annotations, not automatically `po:Segment` events; the semantics may be
mapped later if an exporter needs them. Preserve timeline checks without
materializing a separate timeline table.

Credit the BBC/IPTC sources and preserve their CC BY 4.0 attribution/license
when reusing ontology material. Pin the profile to the reviewed snapshot and
test its small mapping rather than importing the whole ontology dependency tree.
The OMC alternative is not rejected for requiring RDF: it explicitly supports
JSON. It is rejected because its richer production distinctions do not pay for
themselves in this catalog.

### Identity and metadata model

Separate three identities:

```text
videos (logical catalog item)
  1 -> N video_versions (content edition and timeline)
           1 -> N video_assets (backend copy or packaged representation)
                    N -> 1 storage_locations (configured provider namespace)
```

A `series` groups logical videos such as course sessions. It is not a content
version or another record for the same teaching. Keep the three identity levels:
collapsing editions into copies would lose timeline identity; adding separate
work/manifestation/essence hierarchies would not solve another current need.

| Table | Key fields and responsibility |
| --- | --- |
| `videos` | `id`, editorial `title`, `description`, nullable `series_id` and `position`, default `language`, `status`, `visibility`, `revision`, `current_version_id`, timestamps, `deleted_at` |
| `video_versions` | `id`, `video_id`, positive `version_number`, `label`, `language`, nullable `duration_seconds` until verified, `revision`, `preferred_asset_id`, timestamps, `deleted_at` |
| `storage_locations` | `id`, `backend` (`r2`, `stream`, `s3`), `environment` (`dev`, `prod`), `account_id`, provider locator fields below, `delivery_profile_ref`, `enabled` |
| `video_assets` | `id`, `video_version_id`, `location_id`, `external_id`, `kind` (`file`, `package`, `managed`), `is_source`, `state`, `playback_enabled`, nullable `derived_from_asset_id`, nullable `profile`, nullable `byte_size`, nullable `sha256`, nullable `provider_version_id`, nullable `etag`, `revision`, `snapshot_hash`, `last_seen_at`, `verified_at`, timestamps, nullable `error_code`, `deleted_at` |
| `asset_playback_entries` | `asset_id`, `protocol` (`hls`, `dash`, `mp4`), relative `entry_path`; unique `(asset_id, protocol)` |
| `stream_asset_metadata` (later, only with Stream) | `asset_id` (one-to-one FK), provider processing state, `ready_to_stream`, measured duration, `require_signed_urls`, bounded custom metadata and source timestamps |

`state` is one of `pending`, `processing`, `ready`, `failed`, `missing`,
`deleting`, `deleted`. Readiness is technical, not editorial publication.
`playback_enabled` is an explicit curator/ingestion-policy decision, initially
false until validation succeeds. `is_source` records preservation/provenance;
it is independent of playback eligibility. A validated original MP4 can be
both source and playable in one asset row, avoiding duplicate copies or an
exclusive source/playback role. An incompatible source remains non-playable
with `state=failed` and `error_code=conversion_required`; keep the original
bytes for a later conversion. Do not invent another lifecycle state.

These are target tables, not a requirement to implement every provider in the
first migration. The initial R2 file path needs one MP4 entry per playable
asset; add package/protocol and Stream-specific behavior when used.

Provider locators have a discriminated shape, enforced with SQL checks and
typed boundary validation:

| Backend | Location fields | Asset `external_id` and entries |
| --- | --- | --- |
| `r2` | Cloudflare account ID, non-empty bucket; AWS region null | Immutable object key for a file, or immutable package prefix; entries locate MP4 or manifests beneath it |
| `stream` | Cloudflare account ID; bucket and region null | Stream UID; entries use the documented HLS/DASH paths relative to that UID |
| `s3` | AWS account ID, non-empty bucket and region | Immutable object key or package prefix; optional S3 version ID for a single object |

Stream assets have kind `managed`; R2/S3 assets have kind `file` or `package`.
Enforce that relationship during registration and provider inspection.
For a file asset, `entry_path` is empty and `external_id` is its object key.
For a package, every entry is relative to its prefix. Validate and normalize
paths at import, reject traversal/absolute URLs, and require all referenced
segments, captions and keys to stay within the authorized package or explicitly
registered assets. A package inventory records child keys, sizes and checksums
in a private sidecar, together with rendition resolution, codec, bitrate and
duration; do not create D1 rows for every segment.

`delivery_profile_ref` resolves to deployed, allowlisted configuration: R2
binding/media hostname, Stream customer hostname/signing configuration, or
CloudFront distribution/hostname/key group. D1 stores no credentials, private
keys, signed URLs or arbitrary origin endpoints. Secrets stay in the runtime
secret store. API adapters cannot choose a cross-environment account from a
client-supplied locator.

Required integrity rules:

- Primary IDs are application-generated, independent of provider IDs.
  Enforce `UNIQUE(video_id, version_number)` and positive version numbers.
- Location namespaces are unique by environment, backend, account and bucket
  (use partial indexes for Stream's null bucket). Enforce
  `UNIQUE(location_id, external_id)` even for tombstoned assets. A locator
  belongs to one content version; retrying its registration cannot duplicate it.
- `current_version_id` must belong to its video. `preferred_asset_id` must
  belong to its version. Use composite foreign keys with supporting unique
  `(video_id, id)` and `(video_version_id, id)` keys, not unchecked IDs.
  Nullable pointers allow private drafts before ingest completes.
- A derived asset must reference an asset of the same version. Re-encoding
  keeps the version ID; editing, dubbing or changing the timeline creates a new
  version. Cross-version editorial lineage is recorded separately, not as a
  claim of interchangeable copies.
- Asset replacement uses a new ID and immutable key/prefix or Stream UID;
  a storage-level S3 version ID is not a catalog content version. Do not overwrite
  a live package's child objects in place.
- `sha256` identifies exact file bytes, or a canonical package inventory for
  packaged assets. Obtain a source hash through its `is_source` asset and
  derivation link rather than duplicating it on the edition.
  Transcodes need not share byte hashes, and ETags are not portable content
  checksums. Null means unknown, not equal.

Use the minimal series, people, contributor, topic and annotation relationships
above rather than duplicating the historical teaching-work/teacher model.
Untimed editorial metadata stays video-scoped. Time-coded annotations and
transcripts belong to `video_version_id`, with optional `origin_asset_id` of
that same version. A Stream caption imported from one copy can serve equivalent
copies only after timeline/language verification. Store transcript language,
content hash and provenance; avoid duplicate indexing of the same transcript
merely because it exists on two providers. Complete source files remain private
in R2 independently of the video's delivery backend.

Search documents and index jobs carry `video_id`, `video_version_id`, editorial
revision, version revision and transcript revision. Index the current edition
by default and deduplicate results by logical video, not asset. Asset-health
events update playability without creating duplicate embeddings; a current
version change or transcript edit queues reindexing. FTS5 and Vectorize never
authorize results independently of D1.

### Example: one video, two editions, three backends

The IDs below are synthetic; this describes the proposed schema, not the
existing migration.

| Video | Version | Asset | Backend/location | External ID | Purpose |
| --- | --- | --- | --- | --- | --- |
| `video-001` | `version-001`, edition 1 | `asset-r2` | `r2` / `r2-dev` | `video-001/version-001/original.mp4` | Validated source and MP4 playback |
| `video-001` | `version-001`, edition 1 | `asset-stream` | `stream` / `stream-dev` | `stream-uid-a` | HLS/DASH playback |
| `video-001` | `version-001`, edition 1 | `asset-s3` | `s3` / `s3-dev` | `video-001/version-001/master.mp4` | Preserved source |
| `video-001` | `version-002`, edition 2 | `asset-stream-cut` | `stream` / `stream-dev` | `stream-uid-b` | Edited cut; different timeline |

Set `videos.current_version_id = 'version-001'` and that version's
`preferred_asset_id = 'asset-r2'`. The R2 row has `is_source=true` and
`playback_enabled=true`. A later R2 HLS package is another asset under the
same edition, not a new `po:Version`. R2 and Stream are identifiable as
equivalent edition-1 copies by their shared version FK, despite different
encodings. Edition 2 never silently replaces edition 1 during failover.

An operator query to list all copies and distinguish editions:

```sql
SELECT v.id AS video_id, vv.id AS version_id, vv.version_number,
       a.id AS asset_id, l.backend, l.id AS location_id,
       a.external_id, a.is_source, a.state, a.playback_enabled,
       vv.preferred_asset_id = a.id AS is_preferred
FROM videos AS v
JOIN video_versions AS vv ON vv.video_id = v.id
JOIN video_assets AS a ON a.video_version_id = vv.id
JOIN storage_locations AS l ON l.id = a.location_id
WHERE v.id = 'video-001'
ORDER BY vv.version_number, l.backend, a.id;
```

For equivalent copies of a known asset, join `video_assets` to itself on
`video_version_id`. Do not match on title, filename, duration or Stream UID.
Imports attach to an existing version only through a trusted ingest job or
explicit curator confirmation. An uncorrelated external upload becomes a new
private draft for review, never a heuristic merge.

### Ingestion and adapter contracts

Use a small injected `VideoBackend` interface with `inspect(locator)`,
`listInventory(cursor)` and `createPlaybackGrant(asset, protocol, expiry)`.
The returned inspection is typed provider state/capabilities; a playback grant
contains `video_id`, `version_id`, `asset_id`, backend, protocol, URL,
`expires_at` and renewal route, plus a bootstrap URL for cookie-based delivery.
Unsupported capabilities and provider failures are explicit errors,
not empty or success-shaped results.

Use provider-specific upload workflows rather than pretending all backends
accept the same upload operation. R2 and S3 share package validation and
S3-compatible transfer helpers where supported; R2 Worker bindings, AWS
signing/OAC and Stream APIs remain distinct adapters.

Reserve video/version/asset IDs and a deterministic ingestion job before upload.
An R2/S3 job writes an immutable source/package, validates codec and manifest
references, and only then marks the playback asset ready in D1. A complete
package marker/inventory is committed last; a segment-created notification
alone cannot publish it. External FFmpeg or a managed encoder performs video
processing, not a request-serving Worker. Stream processing completion triggers
a provider refresh and readiness/access-configuration check.

For the first R2 MP4 flow, the validated file itself is the complete artifact:
no HLS marker, adaptive encoder or Stream webhook is required. An R2 object
event can wake validation but is neither editorial metadata nor proof of
playability. When adding Stream, explicitly derive/upload another asset from
the R2 source under the same edition; do not create a new logical video or
automatically upload every new R2 object to Stream.

Imported records default to private drafts. Only the initial import may seed
editorial fields from trusted upload metadata. Later backend updates never
overwrite curator title, visibility, notes, preferred copy or publication state.

### Synchronization Boundaries

Events and jobs are keyed by location, external ID and provider generation or
snapshot hash, not globally by Stream UID. Duplicate and out-of-order events
refresh current state and converge without gratuitously bumping revisions.
Sync writes use an asset revision/lease fence and an indexing outbox in a D1
transaction when a searchable version changes.

R2 ingest completion and periodic R2 inventory are implemented first. Existing
Stream locators can be backfilled as unverified assets without calling Stream;
Stream reconciliation starts only when its adapter is explicitly enabled.

When enabled, Stream webhooks report video processing completion or error.
They do not provide complete coverage of Stream metadata edits, caption
changes, or deletions.
Verified webhooks trigger a refresh of current Stream state; they are not treated
as complete state replacements.

For the optional Stream ingress, the Worker verifies the signature against
the raw request body and rejects stale timestamps. It awaits Queue acceptance
before returning success. Queues provide
at-least-once delivery, so consumers use deterministic job keys, D1 revisions,
fenced leases and idempotent upserts.

Every five minutes, reconciliation enumerates configured locations. Stream
enumeration includes records and captions; R2/S3 enumeration operates on
registered objects and complete package inventories, not one video per segment.
A successful complete inventory is required before an absent Stream UID is
tombstoned; the same rule applies to R2/S3 locators. Scope absence to that
location and asset. Losing one copy never deletes its version, other copies or
editorial record. Timeouts, permissions errors, throttling, or partial enumeration
cannot delete catalog records. Known assets receive direct refreshes to detect
metadata edits that creation-time listing cannot identify.

The Stream list API returns at most 1,000 videos, exactly the initial catalog
target. The implementation must prove cursor/window boundary behavior,
same-timestamp handling, count coverage and non-progress detection before
relying on reconciliation to declare a complete inventory.

R2/S3 inventories must also prove complete pagination and package coverage.
Treat unrecognized objects as import candidates, not automatically published
videos. A missing or failed asset remains visible to operators with its reason;
only a confirmed deletion advances its tombstone. Provider deletion and
editorial archival are separate actions.

### Search and Access Boundaries

Supplied transcripts/captions are imported first; existing Stream caption tracks
are an optional later import source. Complete
source files remain private in R2; bounded chunks retain language, provenance,
content hash, revision, and available time offsets in D1. Missing, malformed,
in-progress and failed transcripts are reported, not silently replaced or
automatically generated.

Search combines D1 FTS5 and Vectorize candidates. Before a result, passage, count
or playback reference is returned, D1 verifies that its current revision is
published, visible to the caller, non-deleted and has an eligible ready playback
asset for its current version. Exclude non-current version hits during the
reindexing window. Private notes never
enter derived search documents. Until an identity adapter exists, external
editorial writes and restricted reads fail closed.

### Playback selection and access

The proposed `POST /videos/{id}/playback` endpoint takes a supported protocol
and optional version/asset IDs, not an arbitrary provider URL. The public
catalog returns stable application IDs and supported capabilities; it does not
return raw bucket keys or persistent signed playback references.

1. Authorize the current video publication/visibility and requested version.
   Initially only `current_version_id` can receive a viewer grant; exposing
   older editions requires a later explicit publication policy. D1 remains
   the access authority for every backend.
2. Select the version's preferred asset if it is ready, enabled, non-deleted,
   has the requested protocol and belongs to an enabled location in the current
   environment. Otherwise select another eligible playback asset of the same
   version, ordered by backend policy (`r2`, `stream`, `s3` initially), then ID.
   Return an explicit unavailable/unsupported error if none qualify.
   New R2 ingests select their validated R2 asset as preferred. Explicit
   curator preferences on existing records are preserved; adding Stream does
   not override them. A requested protocol still filters eligibility, so an
   MP4-only R2 asset is not eligible for an HLS request.
3. Issue a provider-specific grant. Stream must require signed URLs, including
   for public catalog entries, so provider links cannot bypass catalog state.
   R2 stays private behind the media Worker. S3 stays private behind CloudFront
   OAC with Block Public Access; custom-policy signed cookies cover the asset
   prefix. Single MP4 downloads may use presigned URLs after authorization.
4. Report the chosen asset in the response and telemetry. Retry/failover is
   bounded, logged and restricted to independently authorized equivalent
   copies. Do not mask credential errors or failed access checks as a reason
   to bypass the policy. A player switches whole sources, retaining position
   where verified compatible; never mix providers' segments in one manifest.

For R2 and CloudFront use renewable 15-minute grants scoped to immutable asset
paths. Renewal rechecks D1 before expiry; long sessions and pauses must exercise
renewal. Cookies use `Secure`, `HttpOnly` and appropriate SameSite settings;
browser Path uses a prefix, not a wildcard. Host media under a controlled
same-site domain and qualify credentialed CORS/native player support.

For cookie-based playback, the client first calls an uncached bootstrap route
on the media hostname with a short-lived, asset/audience-bound ticket from the
Playback API. That route sets host-scoped cookies before manifest loading.
R2's media Worker serves it; CloudFront routes its session path to the catalog
service as a separate uncached origin behavior. Renewal uses the same
media-host boundary. The catalog hostname cannot set cookies for an unrelated
media hostname, and the bootstrap route never grants access from an unsigned
asset ID alone.

For Stream, create a token with a configured signing key, valid for verified
duration plus 30 minutes, capped at 24 hours by application policy. Longer
sessions or pauses require a tested token refresh/source reload.
Do not rely on the default one-hour token for a
two-hour lecture. Keep token-bearing URLs out of logs and shared API caches.

Stateless grants bound revocation rather than providing instant revocation:
existing R2/CloudFront grants can survive for 15 minutes, and Stream grants
until their expiry. Deleting/disabling provider content is a separate
operational action, not the routine unpublish path. If immediate revocation is
required, add an online authorization/revocation design before implementation.
Signed playback controls access; it is not DRM or prevention of screen capture.

The R2 Worker checks authorization before every cache lookup, including for
captions, keys and range requests. Cache only immutable media bytes under
asset/path keys, not cookies or grants. Cache configuration must not bypass
the authorization handler. CloudFront validates signed cookies before serving
cached objects. Protect manifests and every referenced resource, not just the
initial URL.

### Migration from the current Stream-only scaffold

This is a design-only change. `workers/catalog/migrations/0001_catalog_initial.sql`
and `workers/catalog/src/catalog.ts` still require `videos.stream_uid`; neither
implements this model. Do not rewrite an applied migration.

1. Add the new tables, indexes and nullable selection pointers in a new
   migration. Keep existing rows and compatibility reads intact.
2. For each existing video, create edition 1 and one Stream asset in the correct
   configured location. Preserve the application video ID, editorial metadata,
   publication state and revision. Derive stable backfill IDs or persist an
   explicit mapping so reruns cannot duplicate rows. A legacy editorial status
   alone does not prove asset readiness; leave it unverified until the optional
   Stream adapter refreshes it before playback. That refresh does not block
   schema migration or R2 ingestion.
3. Attach existing transcript sources to edition 1 and their known source
   asset. Preserve unknown provenance as null; do not invent hashes or verified
   durations from zero-valued defaults.
4. Move reads, imports, sync jobs and playback to video/version/asset joins.
   During transition, old consumers may read `stream_uid` only for Stream-backed
   records; never insert a fake UID for R2/S3. Gate non-Stream ingestion until
   all writers/consumers support the new contract.
5. Rebuild `videos` in a later contract migration to remove the mandatory
   `stream_uid` and relocate duration to versions/provider observations. Use
   D1's documented foreign-key-safe migration procedure; verify row counts,
   foreign keys and transcript/search relationships before cutover. Only then
   enable R2/S3-only videos. Remove obsolete duplicate fields after the
   compatibility window. Back up and rehearse restore first.

Complete this compatibility cutover before the first live R2 ingest. It is
not conditional on a Stream deployment, webhook or Stream Gate B. If no live
database exists, rehearse the complete migration chain on legacy fixtures and
apply it to the fresh dev database. Where legacy data exists, preserve its
locators and explicit preferences; do not claim the media has moved to R2.
Normalize legacy teacher/topic strings into people/contributor/topic records
with a reviewed mapping; ambiguous names remain review items, not guessed
identities. Do not invent series membership.

Deleting a preferred asset or switching current edition is transactional and
revision-checked. Clear/reassign selection pointers before physical cleanup.
Soft-deletion retention and provider cleanup need their own retryable jobs;
do not cascade a provider disappearance into loss of editorial history.

## Rollout

1. Pin the minimal BBC profile, verify R2 upload/range and Worker/D1 contracts,
   and agree the trusted ingest identity, media validation and migration inputs.
2. Extend the Worker and implement the editorial model, durable jobs and the
   complete expand/backfill/contract migration before new R2-only records.
3. Deliver metadata registration, direct/resumable private R2 upload, trusted
   MP4 validation, D1 browsing and R2 reconciliation.
4. Add the shared playback resolver and private R2 byte-range delivery with
   renewable grants. Qualify this first local/live slice without Stream, AWS,
   adaptive encoding or semantic search prerequisites.
5. Add R2 HLS packaging, then supplied transcript import, FTS5 search and
   semantic/related-video projections as separately reviewable increments.
6. Add optional Stream derivation/import, signed playback, caption import and
   webhook/reconciliation; then S3/CloudFront ingestion/playback.
7. Qualify each enabled backend and cross-provider copies against the same
   identity/access/timeline tests. Live provisioning, migrations, webhook
   registration and production releases require separate ADR-0002 approval.

### Implementation acceptance cases

- The first/default ingest creates a private R2-backed video/edition/asset
  without a Stream UID, Stream/AWS credentials or adaptive encoder service.
- A validated original MP4 can be source and playable in one asset row;
  unsupported media is retained privately with a failed state and explicit
  conversion-required error.
- The BBC profile maps video/edition/series/contributors/subjects without
  duplicate work entities or a graph runtime. Backend copies remain local assets,
  not new `po:Version` records merely because they use a different provider.
- One version with R2 and Stream copies is one catalog result and two
  identifiable assets; either can be preferred without changing video ID.
- A video with only R2 or only S3 has no Stream UID requirement.
- Another edit of that video is a different version; transcripts, annotations
  and failover never cross its timeline implicitly.
- Duplicate registration and webhook replay create no extra video/version/asset
  rows or revision changes when the normalized snapshot is unchanged.
- Invalid provider locator shapes, cross-version preferred assets and
  cross-environment locators are rejected.
- A missing preferred asset can select a verified equivalent copy; incomplete
  inventories and provider authorization failures do not archive the video.
- A partial package, unsupported codec/protocol, pending Stream encode or
  unsigned Stream configuration cannot become eligible for playback.
- Private/draft/archived/deleted content cannot obtain a new grant through any
  backend, including direct origin URLs or warm-cache segment requests.
- Two-hour playback, seek, pause/resume and renewal work for each backend;
  expired grants and denied renewals fail explicitly.
- Backfill preserves IDs, editorial state and transcripts; contract migration
  supports non-Stream-only videos and has a rehearsed restore path.

## References

- [BBC ontologies hosted by IPTC](https://iptc.org/thirdparty/bbc-ontologies/index.html)
- [BBC Programmes model](https://iptc.org/thirdparty/bbc-ontologies/po.html)
- [Programmes terms, version and license](https://iptc.org/thirdparty/bbc-ontologies/po.ttl)
- [BBC Creative Work terms and deprecations](https://iptc.org/thirdparty/bbc-ontologies/creativework.ttl)
- [MovieLabs OMC overview and license](https://github.com/MovieLabs/OMC)
- [OMC asset model](https://github.com/MovieLabs/OMC/blob/main/OMC-JSON/Docs/Tech-Notes/Assets.md)
- [OMC version distinctions](https://github.com/MovieLabs/OMC/blob/main/OMC-JSON/Docs/Tech-Notes/Version.md)
- [Video backend cost and functional comparison](../Cloudflare%20R2%20vs.%20Stream.md)
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
