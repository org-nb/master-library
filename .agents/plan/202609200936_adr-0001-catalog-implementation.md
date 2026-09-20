# Implement ADR-0001: D1 video catalog

Status: Proposed implementation plan. Publishing it does not authorize backend
implementation, data migration, deployment, or shared-infrastructure changes.

Target: [ADR-0001](../../docs/adr/0001-use-d1-for-video-catalog.md).
Delivery: [ADR-0002 implementation plan](202609200921_adr-0002-delivery-implementation.md).

## Goal and boundaries

Build a TypeScript catalog Worker for about 1,000 Stream videos: D1 editorial
metadata, Stream synchronization, private R2 transcript originals, FTS5 keyword
search, Workers AI/Vectorize semantic search, and content-based related videos.
Editorial data, Stream projections, and derived indexes have separate ownership.

The scope includes authenticated API contracts but not an editor UI or identity
provider. Until a trusted identity adapter exists, external editorial writes and
restricted reads fail closed. Exclude personalization, automatic transcription,
upload orchestration, live inputs, analytics lake work, and R2 Data Catalog.

ADR-0002 owns provisioning, secrets, webhooks, deployment and GitHub workflows.
Airtable/media migration needs separate reviewed scope. This plan does not accept
either proposed ADR.

## Completion gates and sequence

| Gate | Evidence and effect |
| --- | --- |
| A: local application readiness | Complete Worker, generated binding contracts, migrations, Workers-runtime tests, synthetic example, operating contracts and delivery handoff. Unblocks ADR-0002 delivery implementation. |
| B: live qualification | Authorized ADR-0002 dev deployment proves Stream, Queues, D1, R2, AI and Vectorize behavior, cost envelope and recovery. Blocks production activation. |

```text
C0 contracts and fixtures
 -> C1 Worker scaffold
 -> C2 schema, APIs and durable work
 -> C3 Stream synchronization
 -> C4 transcripts and keyword search
 -> C5 semantic search and related videos
 -> C6 local readiness (Gate A)
 -> ADR-0002 dev delivery
 -> C7 live qualification (Gate B)
```

Mocks and generated types cannot prove Gate B. Record unresolved live contracts as
release blockers, never as successful tests. Implement each behavior test-first and
run its targeted gate before continuing.

## C0. Verify contracts and implementation inputs

Files: indexed `.agents/design/` contract note, later fixture files, and
`workers/catalog/docs/contracts.md`.

Verify current Wrangler schema/generated types and product contracts for D1, R2,
Queues, Stream, Workers AI and Vectorize. Separate documentation evidence, local
runtime evidence and deferred live evidence.

Establish a complete Stream enumeration strategy for fewer than, exactly and more
than 1,000 videos, including same-timestamp boundaries, saturation and non-progress.
Do not invent cursors. If completeness cannot be proved, deletion must remain
blocked. Verify caption list/WebVTT contracts, webhook signatures/event scope, D1
FTS5/batches and embedding dimensions/response shape.

Using approved non-sensitive samples, select languages, parser, chunk/overlap
limits, model/dimensions/metric, relevance fixtures, payload/query limits,
retry/replay limits and cost envelope. Decide whether Airtable data exists before
planning a one-way import. Do not generate captions.

Acceptance: a versioned contract checklist records choices, rationale and explicit
unresolved blockers without performance guarantees.

## C1. Scaffold a typed, testable Worker

Files: `workers/catalog/{package.json,wrangler.jsonc,tsconfig.json}`, lockfile,
generated binding declarations, test configuration, `src/`, `tests/` and `.gitignore`.

Create one modular Worker exposing `fetch`, `scheduled` and `queue` handlers,
without deployment. Keep domain logic independent of I/O, inject adapters and avoid
mutable module request state. Generate Env from Wrangler rather than duplicating it.

Set the current compatibility date and only needed flags. Enable Logs and Traces
with structured redacted logging and explicit sampling. Declare only non-secret
configuration; local tests use no cloud credentials.

Use the current Workers Vitest integration compatible with pinned Wrangler/Vitest.
Run in the Workers runtime with local D1/R2 and supported Queue facilities; mock
external Stream, AI and Vectorize adapters. Reset test state explicitly.

Acceptance: real handlers run locally with generated bindings, and no deployed
test authorization route or implicit remote request exists.

## C2. Implement schema, editorial APIs and durable work

Files: migrations, `src/{domain,db,api,auth,jobs}/`, API contracts and mirrored tests.

Add append-only migrations with foreign keys, indexes, unique constraints, revisions
and state/range checks. Model stable application video IDs; unique Stream account/UID
projection; editorial videos; teaching works, teachers, topics, annotations and
assets; transcript/search documents; FTS/index/vector state; sync jobs and outbox.
Stream updates never overwrite editorial fields; discovered videos start private.

Implement paginated public reads and protected editorial/import contracts. Validate
input and optimistic revisions; exclude raw source JSON, private notes and secrets
from public DTOs. Bound metadata before D1 insertion.

Atomically commit source/editorial changes with outbox intent. Require active fenced
leases for source transitions. Dispatch outbox messages durably, tolerate duplicates,
provide bounded retry, dead-letter replay and sweeper recovery.

Acceptance: fresh/upgrade migrations, ownership/visibility/auth tests, conflicts,
atomic outbox failures and stale leases all behave correctly.

## C3. Implement Stream bootstrap and reconciliation

Files: `src/stream/`, `src/sync/`, handler wiring and tests.

Verify bounded raw webhook bytes using documented HMAC input, Web Crypto and bounded
replay tolerance. Validate after signature verification, derive deterministic job
keys, and await Queue acceptance before returning success.

Use a webhook as a current-state refresh signal. Compare source hashes, preserve
editorial fields, and fence duplicate, delayed and equal-timestamp updates.

Bootstrap existing videos, then run resumable five-minute inventory and caption work
with bounded fan-out, backpressure and a non-overlap lease. Persist checkpoints only
after child work is durable. Refresh known IDs and captions independently.

Only complete successful inventory can identify missing candidates. Directly recheck
before tombstoning; partial scans, rate limits and errors never prove deletion.

Acceptance: boundary fixtures, interrupted scans, caption-only changes, stale
writers, safe tombstones and replays converge. Five minutes is not a freshness SLA.

## C4. Import transcripts and implement keyword search

Files: `src/transcripts/`, `src/search/`, protected import API and tests.

Import ready Stream captions and supplied WebVTT/plain text using a maintained,
bounded parser. Preserve independent same-language sources, provenance and timing;
plain text has no fabricated offsets. Record missing/malformed/in-progress/failed
states; do not generate transcripts.

Store immutable revisioned originals in private R2 and bounded chunks in D1.
Promote only complete durable manifests; recover partial R2/D1 work by checksum.
Use conservative orphan cleanup.

Maintain FTS5 over allowed public fields with parameterized, safely encoded queries,
bounded pages and tests for punctuation, multilingual input and limits. Before
returning a result, hydrate through D1 to verify visibility, publication,
playability, deletion and active revision.

Acceptance: replacement/deletion and same-language sources are correct, FTS rebuilds
from authoritative data and unavailable text never leaks.

## C5. Add semantic indexing and related videos

Files: embedding/vector/hybrid/related modules, indexing consumers, fixtures and tests.

Use the C0-selected model consistently. Index identity includes source revision,
model/chunker versions and dimensions. Avoid re-embedding unchanged content and keep
private text out of vector metadata.

Use versioned vector IDs and D1 manifests; record accepted mutations separately from
query-visible status. Recover asynchronous write/delete failures and prevent late
jobs from removing the active revision. Model changes require explicit rebuild.

Fuse lexical and semantic candidates with reciprocal-rank fusion, deduplicate by
video and hydrate authorized current data from D1. Related results combine semantic
similarity with shared topic, teacher and series; exclude the seed and give reasons.
On recognized AI/Vectorize outages, return explicitly marked degraded lexical results.

Acceptance: agreed multilingual fixtures pass; stale/private/deleted candidates are
filtered; indexing retries converge; no authorization error becomes degraded success.

## C6. Deliver local application readiness

Files: credential-free fixture example, Worker/API/operations documentation, local
gate configuration, relevant README/changelog updates and indexed handover.

Provide a repeatable example exercising signed ingress, Queue dispatch, D1
projection, R2 transcript storage, lexical and mocked semantic search, editorial
revisions and visibility. It must run real handlers and domain logic.

Complete Workers runtime/integration, migration, type, formatting/lint and security
checks. Compose actual Worker checks with existing Python checks; do not represent a
Python-only Tara gate as TypeScript coverage. Document health/readiness, bindings,
secret names, migration checksums, compatibility, DLQ/outbox repair and rebuild.

Acceptance: Gate A is reproducible, has no placeholder production path, and carries
explicit live blockers into ADR-0002. Stage only approved work; developer commits.

## C7. Qualify live behavior through ADR-0002

After C6 and authorized dev deployment, reuse delivery fixtures to prove Stream
enumeration/captions/webhooks, Queue retries, D1 FTS/batches, R2, AI/Vectorize
visibility and recovery. Inspect the account webhook subscription before separately
authorized changes. Measure representative capacity, cost, lag and completion.

If Airtable migration is needed, require approved mapping, dry run/report,
idempotent identities, validation and recovery. Production editorial use also
requires a real trusted identity integration. Gate B either resolves every platform
blocker or records an architecture-blocking change.

## Publication scope

Publication changes only this plan, the plan index and an indexed handover. It
requires no build, cloud access or remote mutation. Backend implementation and
remote work require separate authorization.

## References

- [ADR-0001 references](../../docs/adr/0001-use-d1-for-video-catalog.md#references)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Stream binding](https://developers.cloudflare.com/stream/manage-video-library/bindings/)
- [Vectorize mutation semantics](https://developers.cloudflare.com/vectorize/reference/client-api/)
