# Implement ADR-0001: R2-first catalog with a minimal BBC profile

Status: Proposed implementation plan, revised 2026-09-27.
Target: [ADR-0001](../../docs/adr/0001-use-d1-for-video-catalog.md).
Supersedes the [2026-09-20 Stream-only plan](202609200936_adr-0001-catalog-implementation.md)
and the earlier Stream-first sequence in this document.
Delivery: [ADR-0002](../../docs/adr/0002-isolate-dev-and-prod-delivery.md)
and its [implementation plan](202609200921_adr-0002-delivery-implementation.md).

Publishing this plan does not accept either proposed ADR or authorize code
changes, migrations, deployments or shared-infrastructure changes.

## Outcome and constraints

The first usable increment registers metadata, uploads to private R2, validates
an MP4, browses D1 and plays it through an authorized byte-range endpoint.
**R2 is the default ingest and default playback preference.** Stream and S3 are
explicit optional integrations, not dependencies of the R2 path.

Use the BBC Programmes relational profile defined in ADR-0001: video
(`po:Episode`) -> content edition (`po:Version`) -> local backend assets.
Keep a small series/person/contributor/subject model. No graph database,
generic entity/edge framework, duplicated CreativeWork record, OMC AssetSC
hierarchy or mandatory ontology export.

The first media release deliberately uses H.264/AAC MP4, not adaptive
streaming. Retain incompatible originals privately and report conversion
requirements. Add HLS packaging next, then search and optional providers.
A supported original can be both source and playable in one asset row.

Exclude a full editor UI, identity-provider deployment, automatic transcription,
live video, DRM, production asset management, personalization and bulk
Airtable/media migration. A small operator ingest tool and playback example
are in scope. Protected commands/APIs require trusted identity; local test
identities cannot become a production bypass.

## Verified baseline

| Surface | Current gap |
| --- | --- |
| `workers/catalog/src/{index,catalog,pipeline}.ts` | Stream-UID fixture catalog; no real ingest/Queue consumer/playback grants. Failed or empty D1 reads fall back to samples. |
| `workers/catalog/migrations/0001_catalog_initial.sql` | Mandatory `videos.stream_uid`; no editions or backend assets. |
| `workers/catalog/test/index.spec.ts` | DB-disabled fixtures do not prove D1 constraints, migrations or durable jobs. |
| `workers/catalog/public/` | Catalog/search display only; preserve route compatibility and render editorial text safely. |
| `workers/catalog/package.json` | `pnpm run check` covers types/Vitest but not Biome. |
| Root CI and delivery | Python-only CI; deployment lacks the complete application gate and uses `development` rather than target `dev`. ADR-0002 must resolve this before activation. |

Extend the existing scaffold. Prior plan publication is not implementation
evidence. All paths below for new modules are proposals, not existing features.

## Execution and release gates

```text
P0 profile/contracts and synthetic fixtures
 -> P1 runtime and environment boundaries
 -> P2 additive schema and legacy backfill
 -> P3 repositories, editorial APIs and durable jobs
 -> P4 compatibility cutover: remove mandatory stream_uid
 -> P5 default R2 registration/upload/validation/browse
 -> P6 shared resolver and protected R2 MP4 delivery
 -> A-R2 local readiness -> authorized ADR-0002 dev delivery -> B-R2
 -> P7 R2 adaptive HLS packaging and qualification
 -> P8 supplied transcripts, FTS, semantic search and related videos
 -> P9 optional Stream integration -> A-Stream -> authorized dev -> B-Stream
 -> P10 optional S3/CloudFront integration -> A-S3 -> authorized dev -> B-S3
 -> P11 cross-backend qualification and production handoff
```

P4 is before live R2-only imports. It does not wait for Stream Gate B.
Existing Stream rows are preserved as unverified assets; calling Stream is
unnecessary for backfill. If live data exists, P4 requires an approved migration
window and restore rehearsal. If no live database exists, apply the complete
tested migration chain to fresh dev storage.

Each package is a reviewable increment: failing focused test, minimum
implementation, targeted checks, relevant docs/example and handoff.
Do not implement every adapter/table solely because it appears in the target
schema. Add provider-specific projections and protocol behavior when used.

| Gate | Evidence |
| --- | --- |
| A, per release profile | Credential-free real Worker/D1 tests, migration checks, typed configuration, runnable synthetic example, operating contract and complete local/CI gate |
| B, per provider/capability | Authorized isolated dev checks of real upload/delivery, private origin, renewal, inventory, recovery and measured cost/quality |
| Production | Applicable A/B evidence, accepted ADRs, trusted identity, reviewed data/recovery plan and separate ADR-0002 approval |

A-R2/B-R2 first cover MP4 ingest/browse/playback, not HLS or semantic search.
P7 adds adaptive-playback evidence without invalidating the useful MP4 slice.
R2-only deployment has no Stream/AWS credentials, webhook or infrastructure.
Optional integrations are deferred in order, not removed from the full ADR.

## P0. Pin the small ontology profile and implementation contracts

Files: `workers/catalog/docs/catalog-profile.md`, `docs/contracts.md` under
the Worker, and `workers/catalog/test/fixtures/`.

Record the exact BBC term URIs, reviewed `po` snapshot/version, CC BY
attribution and local extensions from ADR-0001. Keep SQL/API names readable.
Map one complete teaching to Episode, one edit/timeline to Version, a course
recording group to Series, people to FOAF Person, generic credits to `po:credit`
and topics to Subject. Roles, backend assets, visibility and operational state
are local fields. Do not imply teacher means author or subject.

Use one small mapping fixture to demonstrate a standalone teaching, a series
with two episodes, two editions, two equivalent provider copies and separate
contributor/subject links. Pin a mapping, not a runtime RDF dependency tree.
No production JSON-LD endpoint is needed to prove the profile.

Resolve only decisions needed for the next increment:

| Input | Blocks |
| --- | --- |
| Trusted operator identity and metadata command/API | P5 live ingest; test identities remain local |
| Acceptance of 15-minute grants and revocation window | P6 activation; instant revocation needs a design amendment |
| R2 location, upload limits, resumable transport, media-host/domain | P5/P6 Gate B |
| ffprobe/FFmpeg validation profile and supported devices | P5/P6; a managed transcoder is not needed for compatible MP4 |
| Existing D1 rows, active writers, ambiguity resolution and restore procedure | P2/P4 live migration |
| HLS ladder/segment profile and encoder host | P7 only |
| Corpus languages, parser, chunks, model/dimensions and relevance targets | P8 only |
| Stream API/list/signature contracts or AWS profiles | P9/P10 only |
| Measurable startup/seek/rebuffering, sync-lag and cost thresholds | Respective Gate B |

Use official provider docs and pinned types during implementation.
Create synthetic media/metadata fixtures, including unsupported codecs,
truncated MP4, duplicate completion, unsafe paths, two editions and missing
copies. Keep large media outside Git. No provider or ontology download is
required during normal catalog operation or offline tests.

Exit: profile and current blockers are explicit; later optional decisions do
not block the R2 vertical slice.

## P1. Establish runtime and environment boundaries

Files: Worker package/Wrangler/Vitest configs, generated types,
`src/{index,config}.ts`, `test/`; existing Python delivery renderer and tests.

Reuse Hono, inject clients/signers/clock and test real `fetch`, `scheduled` and
`queue` handlers with local D1/R2. Remove production fixture fallback: empty
catalogs are empty, missing required bindings fail readiness, and query errors
are reported. Fixtures belong to explicit test/demo wiring.

Configure a server-selected default R2 location, separate media/transcript
buckets, and disabled-by-default optional adapters. Reject unknown profile,
backend mismatch, arbitrary origin URL and cross-environment resource IDs.
No production request can choose another account.

Keep `/api/*`; the logical playback route is
`POST /api/videos/{id}/playback`. Explicitly route media/session requests to
authorization, never to static-asset/SPA fallback. Separate non-sensitive
liveness and dependency readiness.

Add Biome as the single JS/TS formatter/linter, remove conflicting formatter
configuration and extend `pnpm run check`. Compose Worker and Python gates in
credential-free CI through ADR-0002 before any live deployment.

Exit: actual handlers and bindings work offline with no fabricated catalog
success or implicit remote calls.

## P2. Expand the schema and backfill legacy identities

Files: append-only `workers/catalog/migrations/*.sql`, `src/db/`,
bounded backfill tooling and migration fixtures.

Keep applied `0001` unchanged. Add editions, locations, assets, playback
entries and selection pointers. Assets use independent `is_source` and
`playback_enabled` flags, not mutually exclusive roles. Source hashes live on
assets, not duplicated on editions. Defer `stream_asset_metadata` until P9.

Add `series`, `people`, `video_contributors`, `topics` and `video_topics`;
do not also create `teaching_works` or `teachers`. Optional series/position,
unique membership/credit links, enum/range checks and composite selection FKs
must work in D1, not only in type validators. Time-coded annotations and
transcript sources belong to editions.

Backfill one edition and Stream locator asset per legacy video using
deterministic IDs or a persisted mapping. Preserve editorial IDs/revisions,
status, visibility and known preferences. Do not infer provider readiness,
invent durations/hashes or claim bytes have moved to R2. Existing numeric
zero duration is unverified unless source evidence says otherwise.

Normalize legacy teacher/topic strings with a reviewed mapping; flag ambiguous
identities and do not invent series. Use resumable bounded jobs and a controlled
write pause or compatibility writer so concurrent creation cannot be missed.
Import location configuration from the active environment, not migration
constants copied from another account.

Exit: fresh/upgrade fixtures, repeated/interrupted backfill, counts and foreign
keys pass. The legacy UID constraint remains until P4.

## P3. Implement repositories, editorial contracts and durable jobs

Files: `src/{domain,db,api,auth,jobs}/`, current handlers/catalog/public consumer
and mirrored tests.

Use indexed D1 pagination/detail/operator joins instead of the 100-row
in-memory inventory. Public DTOs expose video/version IDs and capabilities,
not raw locators or private notes. Protected browse/operator summaries may
show all ingest states; private counts cannot leak through public summaries.

Add revision-checked edition creation, series/contributor/topic edits,
current-edition/preferred-copy selection and archive/soft-delete operations.
Enforce one parent edition/video and same-edition asset provenance. Timed
notes stay edition-scoped. External protected APIs fail closed without the
trusted identity adapter; no deployed test identity route.

Commit source changes and outbox intent atomically. Implement deterministic
jobs, fenced leases, bounded retries, DLQ replay and an outbox sweeper.
Repeated unchanged state does not bump revisions or enqueue redundant work.
Provider I/O stays outside D1 transactions.

Exit: conflicts, membership/ownership checks, stale leases, partial failures,
safe DTO rendering and complete pagination pass actual D1/handler tests.

## P4. Remove the mandatory legacy Stream dependency

Files: contract migration, repositories/fixtures and compatibility/restore guide.

Switch every reader/writer/job/UI to edition/asset joins, then rebuild `videos`
using a rehearsed D1 foreign-key-safe procedure. Remove mandatory `stream_uid`
and move authoritative duration to editions. Retain legacy locators in assets.
Never insert fake UIDs to create R2 videos.

Verify row counts, mapping coverage, constraints, transcript/annotation
ownership and pointers across the complete migration chain. Before live
execution approve the backup, write-control window and restore rehearsal.
Rolling back to a UID-dependent binary after contraction is unsafe; use a
compatible forward fix or the reviewed data restore.

Exit: both fresh and upgraded catalogs accept an R2-only record. No Stream
webhook, API credential or Stream deployment was needed. This is the database
prerequisite for the first R2 release, not a later provider migration.

## P5. Deliver default R2 ingest, validation and browse

Files: `src/backends/{types,r2}.ts`, `src/ingestion/`, operator ingest tool,
metadata schema/example, D1 browse query and tests.

Implement a small injected backend inspection/inventory contract. Do not
implement unused provider adapters. A protected command/API validates editorial
metadata and reserves video/edition/asset/job IDs before upload. Default to the
configured R2 location, create a private draft, and reject unknown locations.

The operator tool sends bytes directly to R2 using scoped SDK/presigned upload
authorization, with multipart/resume for large files. It probes media using
ffprobe and computes integrity data without loading entire videos in memory.
Bind its authenticated report to the job and uploaded object checksum/size;
verify completion server-side. An untrusted client flag or bucket event cannot
mark an asset playable. Treat issued upload authority as temporary: no overwrite
of a verified locator, abort abandoned multipart uploads safely, and finalize
under an immutable key before issuing playback grants.

For compatible H.264/AAC MP4, verify decoding, duration, browser suitability
and fast-start layout. Mark the same asset `is_source=true` and
`playback_enabled=true` only after validation. Unsupported input stays private,
non-playable and reports `conversion_required`; a partial/corrupt upload reports
its own failure. An explicit FFmpeg conversion/remux creates a new asset with
same-edition provenance and does not overwrite the original.

Reconcile registered R2 files on a five-minute resumable schedule. Use complete
pagination/direct recheck before missing/tombstone transitions; permissions
errors and partial scans never delete catalog records. One lost asset cannot
delete its edition/video. Unknown objects are review candidates.

Exit: the upload/browse story demonstrates one video/edition/R2 asset,
idempotent completion, explicit failures and D1 operator browsing without
Stream. Metadata remains curator-owned after initial seeding.

## P6. Add shared selection and protected R2 MP4 playback

Files: `src/playback/`, `src/auth/`, R2 media/session routes, a small playback
page/example, API contract and browser/runtime tests.

Authorize current edition/publication/visibility in D1. Select eligible
preferred asset or the stable default order `r2`, `stream`, `s3`, then ID;
disabled adapters cannot be selected. Set the first validated R2 ingest asset
as preferred. Preserve explicit existing preferences. Explicit asset requests
must match the edition/protocol or fail, not silently select something else.

Return IDs, protocol, URL, expiry and bootstrap/renewal routes. Short-lived
bootstrap tickets are asset/environment/audience-bound and cannot broaden
access. The media-host route sets 15-minute host-scoped secure cookies after
ticket verification; renew only with trusted caller identity and current D1
authorization. Anonymous public playback can renew after checking current
public visibility, not by presenting an expired token alone.

Keep R2 private. Authorize every GET/HEAD before cache lookup. Implement
206/416 ranges, correct headers/types, streaming bodies and credentialed CORS.
Cache immutable payloads, not grants or Set-Cookie. Ensure range/seek and
MP4 pause/resume trigger valid subsequent authorization. Redact signed data.

Failover remains within eligible equivalent assets and is observable/bounded;
do not mask authentication or provider credential errors. The client switches
whole sources, not segments, and reports errors explicitly.

Exit: A-R2 is reproducible offline. Authorized B-R2 proves real private-origin
denial, bootstrap host/cookie scope, seeking, renewal and a two-hour MP4 session.
No Stream/AWS/AI service, HLS package or managed encoder is required.

## P7. Add R2 adaptive packaging

Files: shared package validator, ingest/FFmpeg tooling, R2 adapter/entries,
player example and package tests.

Run external FFmpeg with the agreed HLS ladder. Retain the source and upload
immutable edition/asset prefixes. A canonical sidecar inventories child
keys/checksums/sizes/codecs/bitrates/dimensions/duration; publish completion
marker last. Package retries do not replace active bytes.

Use maintained manifest tooling. Validate every manifest, variant, segment,
init file, caption/key reference and byte range; reject traversal, unregistered
absolute URLs, missing children and unsupported codecs. Keep one package asset,
not a D1 row per segment or rendition. Do not add a new edition for a transcode.

Apply P6 authorization to all child requests. Advertise HLS only when complete;
do not switch preferred copy until validated. Add DASH only when required and
separately tested. Extend reconciliation to complete packages and conservative
orphan cleanup.

Exit: measured adaptive switching/seek/caption behavior passes the agreed
device/network matrix. The original R2 MP4 path still works.

## P8. Add transcripts and search incrementally

Files: `src/{transcripts,search,indexing}/`, transcript/FTS migrations,
AI/Vectorize adapters and relevance fixtures.

Import supplied VTT/plain text first with a bounded maintained parser. Originals
stay private in transcript R2; chunks retain edition/language/hash/provenance
and available offsets in D1. Plain text has no invented timing.
Promote complete imports and recover partial writes by checksum/manifest.
Stream captions are an optional P9 input, not a prerequisite.

Implement FTS5 first, then versioned model/chunker/dimension-aware embeddings,
hybrid ranking and non-personalized related videos. Deduplicate equivalent
provider captions, not independently authored same-language sources.
Edition/timeline changes invalidate the appropriate text/index revisions;
asset-health changes do not require re-embedding.

D1 rechecks publication, access, current edition, revisions and playability
before any result/passage/count. Filter stale vectors and private notes.
Recover asynchronous vector mutations; lexical degradation is explicitly
labeled and cannot hide D1/auth failures.

Exit: multilingual relevance, imports, edition switches, duplicate copies,
deletions, retries and rebuilds pass. None was a blocker for initial R2 ingest.

## P9. Add optional Stream copies and synchronization

Files: `src/backends/stream.ts`, optional Stream projection migration,
webhook/sync/caption modules and tests.

Add Stream only when enabled. Derive/upload from an R2 source explicitly using
the existing video/edition ID; never mirror all R2 uploads automatically.
Uncorrelated external Stream uploads become private review drafts rather than
heuristic matches. Keep new-ingest default and existing preferred asset on R2
unless the curator changes it.

Implement provider processing/signed-URL readiness, token grants, caption
import and raw-body verified webhooks. Await queue acceptance, refresh current
state and deduplicate by location/external ID/snapshot. Stream tokens use verified
duration plus 30 minutes, capped at 24 hours by policy; test renewal/source reload.

Prove inventory coverage for 999/1,000/1,001 records, same timestamps,
non-progress and partial failures. Unknown readiness cannot enable playback;
partial enumeration cannot tombstone copies. Registering the account webhook
or changing existing unsigned videos requires separate approval.

Exit: A/B-Stream proves equivalent R2/Stream edition copies, independent
processing and signed playback, without making R2 depend on Stream health.

## P10. Add optional S3/CloudFront

Files: S3 adapter, CloudFront signer/session routes, shared upload tooling and
tests; optional AWS resources/profiles through ADR-0002.

Reuse R2-era package/integrity contracts with region-aware AWS signing.
S3 object version IDs/ETags are not catalog edition IDs/content hashes.
Implement resumable upload and complete inventory with the same failure rules.

ADR-0002 supplies isolated accounts, private S3 with Block Public Access,
CloudFront OAC and trusted key groups. Use custom-policy signed cookies for
package paths and a separate uncached media-host bootstrap origin behavior.
Reject unsigned bootstrap requests and broader cookie scope. CloudFront
origin access and viewer authorization require separate tests.

Exit: A/B-S3 proves S3-only records and equivalent copies, private origin/cache
behavior, renewal, real media delivery and regional transfer/request costs.
The default ingest is still R2; no AWS configuration is required when disabled.

## P11. Qualify cross-backend behavior and release

Files: repeatable examples, operating guides, README/changelog, qualification
report and indexed handoff. ADR-0002 owns deployment.

Exercise a series with two episodes; one episode with two editions and R2,
Stream and S3 playback assets; independent contributor/subject links.
Switch preferred copy, lose it, switch current edition and rebuild search.
Expect one logical result, same-edition failover and preserved timing.
The ADR's S3 archival source alone is not proof of S3 playback.

Qualify each enabled backend with two-hour playback, subtitles, seek,
pause/resume, expiry/renewal and cold/warm cache on iOS Safari, Android Chrome
and desktop browsers. Accelerated clocks do not replace actual long-session
qualification. Measure the agreed startup/rebuffering, sync lag, Worker CPU,
requests, bytes/minutes and costs, not assumed cache rates.

Rehearse outage, partial inventory, DLQ replay, key rotation, D1 restore,
index rebuild and retryable cleanup. Clear/reassign pointers before deletion;
media disappearance cannot destroy editorial history. Document bounded grant
revocation and the approved recovery path.

Exit: each enabled provider has qualification evidence. Full three-backend
support requires all provider gates; production remains separately approved.

## Validation and handoff

Run the smallest focused test first, then `pnpm run check` from
`workers/catalog` and the root `tara check`. P1 adds Biome to the Worker gate.
Include credential-free migration/configuration and applicable infrastructure
checks in CI before deployment. `pnpm run deploy` is not a validation command.

| Acceptance family | Primary package evidence |
| --- | --- |
| BBC profile without extra work/asset hierarchy | P0/P2/P3 |
| R2-first, no Stream UID/credentials, one source/playable row | P4/P5/P6 |
| Partial/unsupported upload and replay safety | P3/P5/P7 |
| Edition versus copy identity and one search result | P2/P8/P11 |
| Invalid locators, membership and environment isolation | P1/P2/P6 |
| Private origins/cache and long-session renewal | P6/P7/P9/P10 plus live gates |
| Optional Stream/S3 and same-edition failover | P9/P10/P11 |
| Backfill, preserved data and safe recovery | P2/P4/P11 |

Each implementation increment includes its fixture/example, changed contract
documentation, relevant changelog and indexed handoff. Stage only reviewed
files; the developer commits. This documentation revision changes no code,
database or live resource; implementation tests/builds apply to the packages,
not publication of this plan.
