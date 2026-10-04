# oxivault-on-R2 catalog design

**Project:** Master Library
**Date:** 2026-10-04
**Status:** Proposed (with ADR-0003)
**Supersedes:** the D1/Workers catalog architecture in ADR-0001 (delivery
planning in ADR-0002 is revised, not superseded)

## Goal

Redefine the video catalog around four product decisions:

1. **oxivault** is the storage backend for catalog metadata: a Vault-LD
   vault persisted on Cloudflare R2 through its S3-compatible `S3Store`.
2. A **Svelte front-end** is the librarian and audience UI, interfacing
   exclusively with the oxivault HTTP API.
3. Videos are served **directly from R2** (public bucket on a custom
   domain) for cost management; no managed video platform in the
   default delivery path.
4. **Cloudflare Stream remains an option** for publishing selected
   videos, as an explicit per-video editorial action.

This document specifies the revised architecture and reviews the impact
on every existing design artifact (ADR-0001, ADR-0002, the epic, the
upload-and-browse story, and the `workers/catalog` scaffold).

## Architecture

```text
                     Cloudflare Pages (static)
                     ┌────────────────────────┐
   browser ─────────>│  Svelte front-end      │
                     └───────┬────────────────┘
                             │ HTTPS (JSON, CORS)
                     ┌───────▼────────────────┐      ┌──────────────────────┐
                     │ oxivault HTTP API      │─────>│ private R2 bucket    │
                     │ (container host)       │      │ "vault" (notes)      │
                     │  - auth (2 roles)      │      └──────────────────────┘
                     │  - CORS                │      ┌──────────────────────┐
                     │  - presigned uploads   │─────>│ private R2 bucket    │
                     └───────┬────────────────┘      │ "masters" (video)   │
                             │ copy on publish       └──────────┬───────────┘
                             │                       ┌──────────▼───────────┐
   browser <──────────────────────────────────────────┤ public R2 bucket     │
        (video bytes, MP4, byte-range)                │ "media" (custom      │
                             │                        │  domain + CDN cache) │
                     ┌───────▼────────────────┐       └──────────────────────┘
                     │ Cloudflare Stream      │  optional, per video
                     │ (selected videos only) │
                     └────────────────────────┘
```

### Components

| Component | Responsibility | Where it runs |
| --- | --- | --- |
| Svelte front-end | Catalog browsing, search, playback, librarian editing and ingest UI | Static build on Cloudflare Pages (or any static host); no SSR server required |
| oxivault HTTP API | All reads/writes of catalog metadata; presigned upload URLs; publication actions | Container host outside Cloudflare Workers (Python 3.14, FastAPI); dev runs locally against `LocalDirStore` |
| R2 vault bucket (private) | Vault notes: one Markdown note per video, frontmatter metadata, RDF graph | Cloudflare R2, S3 API via `S3Store(endpoint_url=...)` |
| R2 masters bucket (private) | Original video files (MP4 masters), transcripts and other source files | Cloudflare R2 |
| R2 media bucket (public) | Published videos served directly to browsers; custom domain, CDN-cached, byte-range | Cloudflare R2 |
| Cloudflare Stream | Optional managed delivery (HLS/DASH, adaptive) for selected videos | Cloudflare, per-video opt-in |

### Why the API cannot run on Cloudflare

oxivault requires Python 3.14, FastAPI, boto3, RDFLib and Polars.
Cloudflare Workers Python supports a restricted stdlib only and cannot
host this stack. "oxivault on R2" therefore means **oxivault running on
a conventional host while its note objects live on R2** through the
S3-compatible endpoint. This is the single largest consequence of the
new direction: the delivery system is no longer Cloudflare-only, and
ADR-0002 gains a non-Cloudflare component (see the review below). The
host can be any small container/VPS provider; the choice is an open
decision, not part of this design.

## Catalog model in the vault

### Note layout

One note per logical video:

```text
videos/<slug>.md
series/<slug>.md            (optional, one per course/retreat series)
people/<slug>.md            (optional, teachers/contributors)
topics/<slug>.md            (optional, subjects)
transcripts/<slug>.md       (optional, supplied transcripts; body-searchable)
```

Links between notes use Vault-LD wikilinks (`[[people/tkr]]`), which
become RDF relationships; SPARQL and `neighbors()`/`backlinks()` replace
SQL joins. Series, people and topics are notes rather than tables; at
1,000 videos this is simpler and humanly editable.

### Video note frontmatter (target schema)

```yaml
---
slug: teachings-on-bodhicitta
title: Teachings on Bodhicitta
description: ...
series: "[[series/winter-retreat-2026]]"
position: 3
language: en
status: draft          # draft | published | archived
visibility: public     # public | restricted (restricted => never copy to public bucket)
contributors:
  - {person: "[[people/tkr]]", role: teacher}
topics: ["[[topics/bodhicitta]]", "[[topics/mahayana]]"]
versions:
  - number: 1
    label: original
    duration_seconds: 7140
    master:
      r2_key: masters/teachings-on-bodhicitta/v1/original.mp4
      sha256: "..."
      byte_size: 2831046400
      verified: true            # ffprobe report recorded by operator/API
      profile: h264-aac-mp4
    published_key: media/teachings-on-bodhicitta/v1/original.mp4
    stream_uid: ""              # set only when published to Stream
    stream_embed_url: ""
transcript: "[[transcripts/teachings-on-bodhicitta]]"
---
```

The ADR-0001 three-identity discipline (logical video / content edition
/ backend copy) is preserved as structure, but enforced by application
validation instead of SQL constraints:

- A new edition gets a new entry under `versions` with a new number; a
  re-encode of the same edition reuses the version number and adds only
  a new `master`.
- `master.r2_key` is immutable once `verified: true`; corrections create
  a new key.
- `published_key` is populated only after the object exists in the
  public bucket. Its presence is the playback contract; the UI never
  constructs media URLs from `r2_key`.
- `stream_uid` is populated only after a successful Stream publish.

Concurrency: oxivault `put_note` with `If-Match`/ETag optimistic
concurrency is sufficient for a small editor group. The UI must surface
409 conflicts for manual resolution, as oxivault already returns them.

### BBC Programmes profile

ADR-0001's decision to use the small BBC Programmes profile
(`po:Episode`, `po:Version`, `po:Series`, `po:credit`, `po:subject`)
carries over unchanged in semantics and now gets a more natural home:
the profile can be ingested as RDF into the vault (`rdf2vault`), and
the derived graph supports SPARQL without a relational mapping table.
Keep the ADR-0001 mapping table as the semantic reference; drop its
"minimal relational shape" column, which was D1-specific.

## Data flows

### Ingest (librarian, via UI)

1. Librarian creates the video note through the UI (`PUT /notes/videos/<slug>.md`),
   initially `status: draft`, version 1 with an empty master.
2. UI requests a presigned PUT URL for
   `masters/<slug>/v1/original.mp4` (requires the oxivault presign
   extension; the API mints it with the masters-bucket credentials).
   The browser uploads directly to R2; bytes never transit the API host.
   Large files need multipart/resumable handling in the upload client;
   R2 supports S3 multipart.
3. Operator-side (or API-side, later) ffprobe validates H.264/AAC MP4,
   duration and size; the report fields land in frontmatter and
   `verified: true`. Unverified or incompatible files keep
   `verified: false` and are never publishable.
4. The note remains a private draft. Readiness is technical only;
   publication is separate, as in ADR-0001.

### Publish to R2 (default delivery)

1. Librarian sets `status: published` in the UI.
2. The API (or operator job) verifies `verified: true` and
   `visibility: public`, copies the master from the private masters
   bucket to the public media bucket under `published_key`, and writes
   `published_key` back into the frontmatter in one conditional update.
3. The front-end player streams MP4 directly from the media bucket's
   custom domain using byte-range requests; Cloudflare CDN caches the
   object. Cost: R2 storage plus zero egress.

Access control consequence: **publication is the only access boundary**
for R2-delivered video. Anyone with the URL can fetch it; there are no
signed grants, cookies or per-request authorization. This is the
accepted trade-off for direct-from-R2 delivery. `visibility:
restricted` content must never be copied to the public bucket; if
controlled access for such content becomes a requirement, add presigned
GET URLs minted by the API as a later increment, which R2 also supports
through the S3 API.

### Publish to Stream (optional, selected videos)

1. Librarian triggers "Publish to Stream" in the UI for a specific
   video version.
2. The API/operator job has Stream copy the master: same-account R2
   copy, or upload-from-URL. Stream handles encoding and packaging.
3. On success, `stream_uid` and `stream_embed_url` are recorded in the
   frontmatter. The front-end prefers the R2 MP4 by default and offers
   the Stream embed when present (or when the note marks the Stream
   copy as preferred).
4. No webhooks, no reconciliation loop, no queue. Stream state is
   checked manually or on-demand when the embed fails. This is
   acceptable because Stream publication is rare and operator-driven;
   if it ever becomes bulk/automatic, revisit a status-check job.

### Search

- Keyword search: oxivault `search` (literal triples) and
  `search_body` (note bodies, including transcripts).
- Structured queries: SPARQL over the derived graph (series, topics,
  contributor backlinks).
- The API filters results by `status: published` for read-only callers.
- FTS5/Vectorize are dropped. Semantic search is deferred until a
  concrete requirement exists; if it returns, export RDF/triples and
  project into Vectorize without touching the vault model.

## Required oxivault extensions (upstream)

The current oxivault HTTP API cannot back this design as-is. Four gaps,
to be implemented in the oxivault repository:

1. **Authentication.** No auth exists. Add bearer/session auth with a
   read-only role (audience: published content, GET only) and an editor
   role (librarians: full note CRUD, presign, publish actions). Token
   issuance via an operator-managed secret initially; no identity
   provider needed yet.
2. **CORS.** The Svelte origin must be able to call the API from the
   browser. Configurable allowlisted origins.
3. **Presigned uploads.** `S3Store` has no presign operation. Add
   `presign_put(key, expires)` (and later `presign_get`) so uploads and
   optional restricted downloads go directly to/from R2.
4. **Publication actions (optional, alternatively an operator job in
   this repository).** Copy master to public bucket; publish to Stream.
   These need bucket-to-bucket S3 copy plus the Stream API client.

Also note: `POST /graph/sparql` enforces read-only SPARQL by keyword
filtering. Keep it, but it is brittle and must sit behind
authentication, not replace it.

## Cost rationale

From the existing comparison doc's 100-hour library / 1,000-hour
delivery example: Stream approximately $90/month; R2 plus a Worker plan
$7.18/month. Direct public-bucket R2 delivery is cheaper still: R2
storage (Class A ops for the publish copy, zero egress) plus a custom
domain on the free Cloudflare plan. The API host adds a fixed small
monthly cost that Stream would not, but it replaces the entire
D1/Queues/Workers operating surface. Stream charges apply only to
videos explicitly published there.

## Impact review on existing design artifacts

### ADR-0001 (D1 catalog) -- superseded decision, retained guidance

| ADR-0001 element | Disposition |
| --- | --- |
| D1 as authoritative catalog; TypeScript Workers; Queues; outbox; Vectorize/FTS5 projections | Dropped. Replaced by oxivault on R2; search via oxivault; semantic search deferred. |
| R2-first ingest, validated MP4, `playback_enabled` gate | Kept in spirit: `verified` frontmatter gate before publish; operator-side ffprobe. |
| Minimal BBC Programmes profile | Kept; now expressible directly as RDF in the vault. Mapping table remains the semantic reference. |
| Three-identity model (video/version/asset) | Kept as frontmatter structure; enforcement moves from SQL to application validation. |
| Multi-backend `storage_locations`/`video_assets`/grant machinery, cookie bootstrap, Stream webhooks, reconciliation, migration chain | Dropped. Two R2 buckets plus an opt-in Stream publish flag replace it. S3/CloudFront backend: dropped entirely. |
| D1 console browsing, operator ingest tool as first slice | Replaced by the Svelte UI, which now arrives first instead of last. |

### ADR-0002 (dev/prod delivery isolation) -- revised scope

The two-account Cloudflare isolation still applies to the R2 buckets,
Pages, and (if enabled) Stream. New requirements:

- The oxivault API host needs dev and prod instances with isolated R2
  credentials; dev can instead run locally (`LocalDirStore`, synthetic
  fixtures), which the design encourages for most development.
- ADR-0002's "fully on Cloudflare" framing no longer holds; the API
  host (TLS, secrets, backups, patching) becomes part of the delivery
  surface. Its infrastructure-as-code story is simpler (a container and
  env vars) but must not be left untracked.
- GitHub environment secrets gain: R2 access keys for the API (vault +
  masters buckets), API host deploy credentials, Stream API token (only
  when the Stream slice is enabled).

### Epic and upload-and-browse story -- rewritten scope

The epic's first slice changes from "operator tool + D1 console" to
"register metadata in the Svelte UI, presigned-upload to R2, browse in
the same UI". Acceptance criteria about D1 rows, migrations and the
`stream_uid` scaffold cutover are obsolete. The story should be
rewritten when the oxivault upstream extensions land; flagged below as
a follow-up rather than rewritten now, to avoid planning detail ahead of
the API work.

### `workers/catalog` scaffold -- retire

The TypeScript catalog Worker, its D1 migrations and the `stream_uid`
schema are dead code under this design. Recommend deleting the
directory (or archiving the branch) rather than maintaining a scaffold
that no longer has a consumer. Decision deferred to the developer; the
design no longer references it.

### Airtable-era documents -- unchanged

Historical; already marked as such.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| oxivault is 0.x with no auth/CORS/presign yet | All four gaps are scoped above; we own the upstream project. Land auth + CORS before any public exposure. |
| Public bucket = URL-sharing access control | Accepted trade-off; publication is an editorial act. `visibility: restricted` never enters the public bucket. |
| No relational constraints (orphan keys, bad versions) | Application validation at the API boundary; `oxivault issues()` and a small lint job over frontmatter catch drift. |
| SPARQL endpoint exposure | Auth-gated; read-only keyword filter retained as defense-in-depth. |
| In-memory graph rebuild cost at 1,000 notes | oxivault caches the derived graph with fingerprint-based invalidation; snapshot limit (256 MiB default) is configurable. Benchmark during the dev slice. |
| API host is a new always-on component and single point of failure for metadata | Small, stateless, restartable; vault state lives in R2. Static front-end degrades gracefully (catalog read failures) but published video URLs keep working from R2 directly. |
| Master/published copy divergence (master updated, public stale) | `published_key` written in the same conditional update as the copy confirmation; a periodic consistency check compares object ETags/sha256. |

## Open decisions (developer input required)

1. **API host choice.** Any container host (Fly.io, Hetzner VPS, etc.).
   Not blocking the design; blocks deployment only.
2. **Auth mechanism.** Static bearer tokens vs. a tiny session login.
   Recommend static tokens for the first slice.
3. **`workers/catalog` retirement.** Delete now or after the first
   Svelte slice is demonstrably working?
4. **Media custom domain.** Needs a zone decision (same zone as the
   front-end, or a dedicated media host).
5. **Whether publication copy lives in the API or as an operator job**
   (oxivault extension vs. a small script in this repository).

## Rollout

1. oxivault upstream: auth, CORS, presigned upload (blocking for
   everything browser-facing).
2. Dev slice: local `oxivault serve` + `LocalDirStore`, Svelte UI
   scaffold, fixture notes and videos; exercise the full note CRUD,
   search and playback-selection logic offline.
3. R2 slice: three buckets (vault, masters, media), custom domain on
   media, `S3Store` pointed at the vault bucket; presigned ingest
   against real R2.
4. Publish slice: copy-to-public flow, front-end playback from the
   media domain, publication state gating.
5. Stream slice (optional, last): per-video publish, embed fallback in
   the player.

Each slice is independently reviewable and demoable, per the project
workflow.

## Success criteria

- A librarian registers, uploads and publishes a video entirely through
  the Svelte UI with no engineering involvement and no D1/Stream touch.
- A published video plays directly from the R2 media domain, seekable
  via byte-range, with no per-delivery platform cost.
- A selected video published to Stream plays from its embed URL, with
  `stream_uid` recorded in the vault.
- Search in the UI returns published videos by keyword, transcript text
  and topic/person links.
- The vault remains plain Markdown on R2: `oxivault vault2rdf` export
  works as a full metadata backup.
