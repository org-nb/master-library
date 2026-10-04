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
- The oxivault API runs on a conventional **container/VPS host**,
  co-located with the SvelteKit front-end server in one container
  (ADR-0004); it is bound to loopback and never exposed to browsers.
- Video files use a **private-by-default** model with explicit
publication to public delivery.
- Cloudflare Stream remains an **opt-in publication path** for selected
videos, not a synchronized backend copy.

Master Library content is typically produced in three related forms:

1. **Original recordings** of full talks (often long-form, hours).
2. **Edited clips** (topic/theme cuts, often 1 to 15 minutes).
3. **Shorts** (typically under one minute).

The catalog must model lineage across those forms while keeping playback
paths deterministic and safe.

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
- Publish and unpublish operations must be robust against wrong paths,
  retries and partial failures.

## Considered Options

1. **oxivault vault on R2 via `S3Store`, oxivault HTTP API as the
   application backend, Svelte UI, two R2 media buckets
   (private/public), pointer-based publication, optional Stream
   publication.**
2. **Keep ADR-0001 unchanged:** D1 + TypeScript Workers + Queues +
   Vectorize, D1 console browsing, operator ingest tool.
3. **Hybrid: D1 as editorial truth mirrored into oxivault for search
   and graph queries.**

## Decision Outcome

Chosen option: **1**. The oxivault vault, stored on R2 through its
S3-compatible `S3Store`, is the authoritative catalog. The Svelte
front-end calls the oxivault HTTP API for all reads and writes.

Media is split across two buckets integrated by oxivault metadata and
operations:

- `media-private`: default ingest and authenticated playback source.
- `media-public`: publicly accessible playback objects.

The catalog spans both private and public videos through explicit
frontmatter (`visibility`, publication state, private locator, public
locator, lineage fields). Publication uses a **pointer pattern**:

1. copy the validated private playback object to the public bucket,
2. verify the copy,
3. write a pointer object in the private bucket,
4. update note metadata.

The private source object is **never deleted**. Published items
therefore occupy storage in both buckets; this accepted duplication
buys three properties: the archival source always stays private,
publish is copy-only and therefore trivially idempotent, and unpublish
restores private-only state without copying bytes back.

Option 2 is superseded: its operational surface (D1 migrations, Queues,
outbox jobs, grant/cookie bootstrap flows, provider adapters) is not
justified at this scale, and the D1-console browsing story never met the
librarian-facing goal. Option 3 is rejected: dual-write between D1 and a
vault creates two sources of truth and a synchronization problem where
none is needed.

### Consequences

- Good: one metadata system, one API, one UI; no D1, Queues, Vectorize
  or Worker code to operate for the catalog.
- Good: direct public-bucket delivery is storage-cost-only; Stream cost
  applies only to videos explicitly published there.
- Good: the vault is plain Markdown on object storage; backup is an
  `oxivault vault2rdf` export or a `GitStore` mirror, not a database
  dump.
- Good: the private source is never deleted, so publish is copy-only,
  idempotent and recoverable, and the archival source stays private.
- Bad: oxivault cannot run on Cloudflare Workers (Python 3.14, FastAPI,
  boto3, RDFLib, Polars); the API lives in the co-located container and
  delivery is not Cloudflare-only.
- Bad: published items occupy storage in both buckets; accepted for
  preservation and simpler convergence over the small extra cost.
- Bad: no relational constraints. Integrity rules degrade to frontmatter
  conventions plus application validation and optimistic concurrency
  (`If-Match`/ETag).
- Bad: unpublish is editorial, not instant revocation; edge caches and
  saved URLs keep serving until the cache entry expires or is purged.
- Bad: public-bucket delivery means publication is the access boundary;
  there are no per-request playback grants for public content.
- Bad: keyword search via oxivault literal/body search and SPARQL;
  semantic search is deferred until a concrete need exists.

## Media lineage model: recording, edit, short

### Identity levels

ADR-0001's asset level is dropped: each version has one canonical
playback object, and backend copies are not separate identities. The
remaining hierarchy gains explicit lineage:

```text
event (po:Series)
  -> recording item (po:Episode, tier=recording)
      -> one or more versions (po:Version)
          -> derived item (po:Episode, tier=edit|short)
              -> one or more versions (po:Version)
```

Rules:

- A full talk recording is a first-class `po:Episode` with
  `content_tier=recording`.
- An edited clip is a separate `po:Episode` with `content_tier=edit`.
- A short is a separate `po:Episode` with `content_tier=short`.
- A derived item (`edit` or `short`) must reference at least one source
  recording item and source version.
- Lineage is represented in metadata and RDF, not inferred from file
  names alone.

### Required lineage metadata per derived item

- `source_episode_ids`: one or more source recording item IDs.
- `source_version_ids`: one or more source version IDs.
- `source_ranges`: list of `{source_version_id, start_seconds,
  end_seconds}` ranges.

This supports clips built from one source talk or from multiple source
recordings.

### Event identity

Keys and lineage depend on a stable event identity. Events are
first-class catalog notes (`po:Series`) with an immutable `event_id`
and a readability-only `event_slug`, analogous to the place registry.
Keys are built from the registered `event_id`, never from a
caller-supplied value; the ID assignment contract is frozen together
with the place registry before ingest goes live.

## Architecture

```text
Librarian/audience browser
  -> SvelteKit SSR server (public port, sessions; ADR-0004)
       -> oxivault HTTP API (loopback, same container, service token)
            -> Vault -> S3Store -> private R2 bucket (vault notes)
            -> boto3 -> private R2 media bucket (recordings + private edits/shorts)
            -> boto3 -> public R2 media bucket (published edits/shorts/recordings)
       <-- playback locator/URL based on visibility + publication state
  -> public media custom domain -> public R2 media bucket bytes
  -> optional: Stream embed for videos published to Stream
```

## Bucket and key naming convention

### Bucket names

Use deterministic environment-scoped names:

- `master-library-vault-<env>` (vault notes; private, S3 API via
  `S3Store`)
- `master-library-media-private-<env>`
- `master-library-media-public-<env>`

Examples:

- `master-library-media-private-dev`
- `master-library-media-public-dev`
- `master-library-media-private-prod`
- `master-library-media-public-prod`

Rules:

- `private` and `public` buckets for one environment must share the same
  `<env>` suffix.
- API config must load both names as a required pair.
- Clients never provide bucket names; the API chooses bucket by
  operation.

### Root path requirement

All media keys in both buckets must start with:

- `YYYY/<place-slug>/...`

Keys contain **no leading slash**; a leading slash creates an empty
path segment and must be normalized away by the key builder.

Where:

- `YYYY` is the canonical year for the item.
- `<place-slug>` is the canonical kebab-case short name for a unique
  place. Prefer the BBC Programmes `po:Place` term if the pinned IPTC
  snapshot defines it; otherwise use the local `nb:Place` term. Verify
  the term against the pinned snapshot before rollout; the registry
  mapping is independent of the vocabulary choice.

Required canonical mapping fields:

- `place_iri`: canonical ontology IRI.
- `place_slug`: immutable kebab-case short name mapped 1:1 to `place_iri`.

### Tiered key templates

After `YYYY/<place-slug>/`, add an explicit tier segment and canonical
item identifiers.

Tier segment values:

- `recordings`
- `edits`
- `shorts`

Recommended private/public playback key templates:

- Recording:
  `YYYY/<place-slug>/recordings/<event-id>--<event-slug>/<episode-id>--<episode-slug>/v<edition>/playback.mp4`
- Edit:
  `YYYY/<place-slug>/edits/<event-id>--<event-slug>/<episode-id>--<episode-slug>/v<edition>/playback.mp4`
- Short:
  `YYYY/<place-slug>/shorts/<event-id>--<event-slug>/<episode-id>--<episode-slug>/v<edition>/playback.mp4`

Pointer object path (private bucket):

- `YYYY/<place-slug>/<tier>/<event-id>--<event-slug>/<episode-id>--<episode-slug>/v<edition>/published.pointer.json`

Robustness rules against wrong path:

- The API must build keys from trusted metadata only (`year`,
  `place_slug`, `content_tier`, `event_id`, `episode_id`, `edition`).
- Upload/publish APIs must reject caller-supplied arbitrary object keys.
- On publish, destination key must equal canonical private relative key
  (bucket differs, stem identical).
- `event-id` and `episode-id` are immutable IDs; slugs are for readability
  only.

## Pointer pattern implementation

Pointer object format (`published.pointer.json`):

```json
{
  "kind": "oxivault-public-pointer/v1",
  "content_tier": "edit",
  "source_bucket": "master-library-media-private-prod",
  "source_key": "2026/bodhgaya/edits/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/playback.mp4",
  "target_bucket": "master-library-media-public-prod",
  "target_key": "2026/bodhgaya/edits/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/playback.mp4",
  "public_url": "https://media.example.org/2026/bodhgaya/edits/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/playback.mp4",
  "etag": "\"...\"",
  "published_at": "2026-10-04T12:00:00Z"
}
```

Publish operation (`visibility: private` -> `public`) is copy-only and
must be idempotent and resumable. The state machine is keyed on the
pointer and the verified public object, never on the private source
(which is never deleted):

1. Build canonical keys from note metadata and validate tier/path.
2. If the pointer exists and `HeadObject` verifies the public object
   (size, ETag/checksum), continue at step 4. Otherwise:
3. `CopyObject` private source -> public playback key, then verify the
   destination (`HeadObject`: size, checksum/etag). On failure, set
   `publication_state=publish_failed` with the reason and stop.
4. Write/overwrite the pointer object at the deterministic private
   pointer key.
5. Update note frontmatter (`public_object_key`, `pointer_key`,
   `publication_state=published`) under optimistic concurrency.

Because every step either verifies existing state or is a no-op when
replayed, a rerun after any failure converges without special cases.
`publish_failed` is set when copy or verification fails and clears on
the next successful attempt.

Unpublish (`public` -> `private`):

1. Verify the private source object still exists (`HeadObject`).
2. Delete the public playback object.
3. Delete the pointer object.
4. Update note frontmatter (clear `public_object_key` and `pointer_key`,
   `publication_state=draft`, `visibility=private`) under optimistic
   concurrency.

The pointer is removed only after the private source is confirmed
present. Unpublish is editorial, not instant access revocation: the
Cloudflare edge cache and any saved URLs keep serving until the cache
entry expires or the media hostname cache is purged. Purge the cache
(or configure a bounded cache TTL) as part of the unpublish operation.

## `context.jsonld` extensions for vault catalog

Keep BBC Programmes terms for core identity and use local extensions for
operational and lineage fields.

Expected vault-level context file: `context.jsonld` (or equivalent
included context used by oxivault notes).

Minimum context additions:

```json
{
  "@context": {
    "po": "http://purl.org/ontology/po/",
    "dcterms": "http://purl.org/dc/terms/",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "prov": "http://www.w3.org/ns/prov#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "nb": "https://master-library.example/ontology/",

    "content_tier": "nb:contentTier",
    "publication_state": "nb:publicationState",
    "visibility": "nb:visibility",

    "place_iri": {
      "@id": "nb:placeIri",
      "@type": "@id"
    },
    "place_slug": "nb:placeSlug",

    "source_episode": {
      "@id": "nb:sourceEpisode",
      "@type": "@id"
    },
    "source_version": {
      "@id": "nb:sourceVersion",
      "@type": "@id"
    },
    "source_start_seconds": {
      "@id": "nb:sourceStartSeconds",
      "@type": "xsd:decimal"
    },
    "source_end_seconds": {
      "@id": "nb:sourceEndSeconds",
      "@type": "xsd:decimal"
    },

    "private_object_key": "nb:privateObjectKey",
    "public_object_key": "nb:publicObjectKey",
    "pointer_key": "nb:pointerKey"
  }
}
```

Notes:

- Context terms use the **exact frontmatter field names** so oxivault's
  frontmatter-to-RDF derivation needs no renaming step; the `nb:` IRIs
  carry the semantic identity.
- `private_object_key`/`public_object_key` replace the earlier
  `private_key`/`public_key` naming to avoid collision with
  cryptographic-key semantics.
- `nb` is the local Nalandabodhi namespace prefix used by this catalog.
- `content_tier` values are controlled as `recording`, `edit`, `short` by oxivault API lineage validation; the JSON-LD context defines term meaning only and does not enforce enum constraints by itself.
- Derived items should also use `prov:wasDerivedFrom` to reference source
  episode/version resources.
- Operational fields (`visibility`, `publication_state`, storage keys) are
  local terms and must not be asserted as BBC ontology semantics.

## Required oxivault extensions

Tracked upstream in the oxivault repository, not in this repository:

1. **Loopback service authentication.** A static service token for the
   co-located SvelteKit server (ADR-0004). Browsers never reach the
   API, so CORS is not required and multi-user auth is deferred until a
   second API consumer exists.
2. **Presigned URLs.** `presign_put(key, expires)` for direct browser
   upload and `presign_get(key, expires)` for private playback/download.
3. **Canonical key builder and validator.** Build keys only from trusted
   metadata fields and reject path mismatches.
4. **Place registry validation.** Enforce 1:1 mapping of `place_iri`
   to immutable `place_slug`.
5. **Lineage validation.** Enforce tier rules and required source links:
   `edit|short` must declare source recording episode/version and ranges.
6. **Pointer publish/unpublish operations.** Copy, verify, write pointer,
   delete source, update frontmatter with idempotent retries.

## Notes on identity and integrity

The metadata model must include, per playable item version:

- `content_tier` (`recording`, `edit`, `short`),
- `visibility` (`private` or `public`),
- `publication_state` (`draft`, `publishing`, `published`,
  `publish_failed`, `unpublishing`),
- `place_iri` and `place_slug`,
- `private_object_key` and/or `public_object_key`,
- `pointer_key` when published via pointer pattern,
- lineage fields (`source_episode_ids`, `source_version_ids`,
  `source_ranges`) for `edit` and `short`.

Application-level validation in the API/UI replaces SQL constraints.
The ADR-0001 migration section and its D1 acceptance cases are obsolete;
its BBC-profile mapping table remains the semantic reference.

## Rollout

1. oxivault upstream: loopback service token, presigned upload/download
   support.
2. Define and freeze the place and event identity registries
   (`place_iri` <-> `place_slug`, `event_id` <-> `event_slug`),
   verifying the chosen place term against the pinned BBC snapshot.
3. Define and freeze tier and lineage contract (`recording`, `edit`,
   `short`) and source-range schema.
4. Dev environment: `oxivault serve` on local `LocalDirStore`; Svelte UI
   scaffolded against it; fixture notes and fixture videos.
5. R2 setup: private vault bucket + private media bucket + public media
   bucket + public custom domain; keep oxivault API on container/VPS.
6. Ingest slice: register metadata (including place and tier fields),
   presigned upload to private bucket, operator ffprobe report into
   frontmatter.
7. Publication slice: implement idempotent pointer publish/unpublish
   workflow and metadata transitions.
8. Optional Stream slice: per-video publish, `stream_uid` in
   frontmatter, Stream embed in the UI player when present.

## References

- [ADR-0001: Use D1 for the video catalog](0001-use-d1-for-video-catalog.md)
  (superseded decision; BBC profile guidance retained)
- [ADR-0002: Isolate dev and prod delivery](0002-isolate-dev-and-prod-delivery.md)
- [oxivault](https://github.com/dkapitan/oxivault)
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare Stream upload from URL / copy](https://developers.cloudflare.com/stream/uploading-videos/)
- [PROV-O](https://www.w3.org/TR/prov-o/)
- [Video backend cost comparison](../Cloudflare%20R2%20vs.%20Stream.md)
