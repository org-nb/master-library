# ADR-0003: Use oxivault on R2 for the video catalog

- **Status:** Proposed
- **Date:** 2026-10-04
- **Authors:** Daniel Kapitan
- **Supersedes:** [ADR-0001](0001-use-d1-for-video-catalog.md) (storage and catalog decision only)

## Context and Problem Statement

ADR-0001 proposed D1 as the authoritative relational catalog with
TypeScript Workers, Queues, Vectorize and an elaborate multi-backend
asset/grant model. The product direction has changed:

- [oxivault](https://github.com/dkapitan/oxivault) (Vault-LD knowledge
  graph store, maintained by the same author) becomes the catalog and
  metadata backend, storing its vault on Cloudflare R2.
- A Svelte front-end replaces the D1-console browsing story and becomes
  the librarian-facing UI, talking to the oxivault HTTP API.
- Video files are served **directly from R2** (public bucket, custom
  domain) for cost management. R2 has zero egress fees; the
  Stream-per-minute delivery model is not worth it for the default path.
- Cloudflare Stream remains an **opt-in publication path** for selected
  videos, not a synchronized backend copy.

Approximately 1,000 videos, a small number of trusted librarian editors,
and a reading audience. The question: which architecture delivers
ingest, browse, search and playback with the least operational surface?

## Decision Drivers

- One storage and metadata system to operate, not a database plus a
  search projection plus a queue plus a Worker per concern.
- The author already maintains oxivault; extending it is cheaper than
  building and operating a bespoke D1 Worker stack.
- Direct R2 delivery keeps media costs near storage-only pricing.
- Markdown notes with frontmatter are human-editable and git-exportable;
  RDF/SPARQL gives structured queries without a separate database.
- Stream is a per-video editorial choice, not infrastructure policy.
- Development must run fully offline (local store) before touching R2.

## Considered Options

1. **oxivault vault on R2 via `S3Store`, oxivault HTTP API as the
   application backend, Svelte UI, public R2 media bucket, optional
   Stream publication.**
2. **Keep ADR-0001 unchanged:** D1 + TypeScript Workers + Queues +
   Vectorize, D1 console browsing, operator ingest tool.
3. **Hybrid: D1 as editorial truth mirrored into oxivault for search
   and graph queries.**

## Decision Outcome

Chosen option: **1**. The oxivault vault, stored on R2 through its
S3-compatible `S3Store`, is the authoritative catalog. The Svelte
front-end calls the oxivault HTTP API for all reads and writes.
Video masters live in a private R2 bucket; published videos are served
directly from a public R2 bucket on a custom domain. Publishing a video
to Stream is an explicit operator action recorded in the note
frontmatter; there is no webhook, reconciliation or queue machinery.

Option 2 is superseded: its operational surface (D1 migrations, Queues,
outbox jobs, grant/cookie bootstrap flows, provider adapters) is not
justified at this scale, and the D1-console browsing story never met the
librarian-facing goal. Option 3 is rejected: dual-write between D1 and a
vault creates two sources of truth and a synchronization problem where
none is needed.

### Consequences

- Good: one metadata system, one API, one UI; no D1, Queues, Vectorize
  or Worker code to operate for the catalog.
- Good: direct R2 delivery is storage-cost-only; no per-minute or
  per-request delivery charges beyond ordinary Cloudflare caching.
- Good: Stream cost is incurred only for videos an editor explicitly
  publishes there.
- Good: the vault is plain Markdown on object storage; backup is an
  `oxivault vault2rdf` export or a `GitStore` mirror, not a database dump.
- Good: the minimal BBC Programmes profile from ADR-0001 carries over
  as RDF semantics inside the vault; SPARQL replaces SQL joins.
- Bad: **oxivault cannot run on Cloudflare Workers** (Python 3.14,
  FastAPI, boto3, RDFLib, Polars). The API must run on a conventional
  host (container/VPS), so delivery is no longer Cloudflare-only and
  ADR-0002 gains a non-Cloudflare component.
- Bad: the oxivault HTTP API currently has **no authentication and no
  CORS support**; both are prerequisites for exposing it to a browser
  front-end and must be built (upstream, since we own the project).
- Bad: direct R2 delivery means publication is the access-control
  boundary. Anything in the public bucket is public; there are no
  per-request playback grants. Content needing controlled access cannot
  use the public bucket.
- Bad: no relational constraints. Video/version/asset integrity rules
  from ADR-0001 degrade to note-level frontmatter conventions plus
  optimistic concurrency (`If-Match`/ETag).
- Bad: keyword search via oxivault literal/body search and SPARQL;
  semantic search is deferred until a concrete need exists.

## Architecture

```text
Librarian/audience browser
  -> Svelte front-end (static, Cloudflare Pages)
       -> oxivault HTTP API (container host, auth + CORS)
            -> Vault -> S3Store -> private R2 bucket (vault notes)
            -> boto3 -> private R2 bucket (video masters, presigned upload)
       <-- playback URL
  -> public R2 bucket (custom domain) serves MP4 video bytes directly
  -> optional: Stream embed for videos published to Stream
```

Publication flow: an editor flips `status` to `published` in the UI; the
API (or an operator job) copies the master from the private bucket to
the public media bucket and records the public key in the frontmatter.
Stream publication is a second, independent action: upload/copy from R2
into Stream, then record `stream_uid` and the embed URL in the
frontmatter.

## Required oxivault extensions

Tracked upstream in the oxivault repository, not in this repository:

1. **API authentication.** Bearer-token or session auth with two roles:
   read-only (audience, published content) and editor (librarians).
   Read-only SPARQL is the current filter-based approach; keep it but
   treat it as defense-in-depth behind auth, not the only control.
2. **CORS configuration** for the front-end origin(s).
3. **Presigned upload URLs.** `S3Store` needs a
   `presign_put(key, expires)` operation so the browser can upload large
   masters directly to R2 without proxying bytes through the API host.
4. **Publication helper (optional).** A small server-side operation or
   CLI that copies a verified master from the private to the public
   bucket; alternatively keep this as an operator job in this repository.

## Notes on identity and integrity

Keep ADR-0001's three-identity discipline conceptually, mapped onto
notes: one note per logical video; editions as repeated frontmatter
structures (or child notes when timelines diverge); backend copies as
frontmatter entries with explicit keys. Application-level validation in
the API/UI replaces SQL constraints. The ADR-0001 migration section and
its D1 acceptance cases are obsolete; its BBC-profile mapping table
remains the semantic reference.

## Rollout

1. oxivault upstream: auth, CORS, presigned upload.
2. Dev environment: `oxivault serve` on a local `LocalDirStore`; Svelte
   UI scaffolded against it; fixture notes and fixture videos.
3. R2: private vault bucket + private masters bucket + public media
   bucket with custom domain; point oxivault `S3Store` at the vault
   bucket endpoint.
4. Ingest slice: register metadata (note), presigned upload, operator
   ffprobe report into frontmatter, publish-to-public flow.
5. Optional Stream slice: per-video publish, `stream_uid` in
   frontmatter, Stream embed in the UI player when present.

## References

- [ADR-0001: Use D1 for the video catalog](0001-use-d1-for-video-catalog.md)
  (superseded decision; BBC profile guidance retained)
- [ADR-0002: Isolate dev and prod delivery](0002-isolate-dev-and-prod-delivery.md)
- [oxivault](https://github.com/dkapitan/oxivault)
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare Stream upload from URL / copy](https://developers.cloudflare.com/stream/uploading-videos/)
- [Video backend cost comparison](../Cloudflare%20R2%20vs.%20Stream.md)
