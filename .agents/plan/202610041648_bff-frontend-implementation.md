# Implementation plan: BFF first, then front-end

**Project:** Master Library
**Date:** 2026-10-04
**Status:** Proposed
**Implements:** ADR-0003 (as amended), ADR-0004, ADR-0005
**Pinned dependency:** `oxivault==0.2.1` from PyPI
**Method:** test-driven; one deployable container

## Ground rules

- **Test-first.** Every slice below starts with failing tests that
  describe the behavior, then the minimum code to pass. One failure
  points to one cause: keep tests independent and mock all I/O so unit
  tests run offline. Integration tests run against real oxivault 0.2.1
  and MinIO (S3-compatible, R2 stand-in).
- **One container.** The end state is a single image: SvelteKit Node
  server (public) + oxivault API (loopback, editor bearer token,
  `S3Store` on the private bucket with prefix `vault/`). No second
  deployable exists at any point in the plan.
- **BFF discipline** (ADR-0004): the browser sees one origin; the
  server validates and calls oxivault/S3; no business logic duplicates
  oxivault's.
- **Gate:** each slice ends with `biome check`, `svelte-check`,
  `vitest`, `pytest` (fixture tooling only), Playwright integration,
  and a runnable demo.

## oxivault 0.2.1: capabilities and gaps

| Capability | In 0.2.1 | Plan action |
| --- | --- | --- |
| Notes CRUD with ETag/`If-Match` (409 on conflict) | Yes | BFF client wraps and maps errors |
| Search, `/graph/edges`, SPARQL (read-only enforced) | Yes | Use for reader/agent read tools and graph payloads |
| OAuth2 bearer + session auth, `read`/`editor` roles | Yes | BFF holds the editor token server-side; auth disabled for browsers (loopback only, CORS off) |
| `presign_put`/`presign_get` + `/objects/presign-*` endpoints | Yes | BFF mints via loopback; R2-side CORS configured for browser PUT |
| `/publication/notes/{path}` metadata update + same-store prefix copy | Partial | Metadata updates usable; **cross-bucket pointer publish is a BFF responsibility** |
| Canonical key builder, place/event registry, lineage validation | No | BFF application logic |
| OIDC/Google login, sessions, allowlist | No | BFF per ADR-0005 |
| Agent orchestration, SSE, metering | No | BFF per ADR-0004 |

## Repository and stack setup

- New `app/` directory: SvelteKit + TypeScript, `adapter-node`, pnpm,
  Biome (lint/format/import sort; no ESLint/Prettier), vitest,
  Playwright. No UI component framework; zod for schemas.
- `fixtures/`: a fixture vault (notes for 2 events, 4 episodes across
  tiers with lineage), a tiny generated MP4, a place/event registry
  fixture, and fixture frontmatter for the 0.2.1 server.
- Dev runs two local processes with identical contracts to prod:
  `oxivault serve` on `127.0.0.1:8000` against a `LocalDirStore` seeded
  from `fixtures/`, plus `vite dev`. A `docker compose` file adds MinIO
  for storage-slice integration tests.
- Container: multi-stage Dockerfile. Stage 1 builds the SvelteKit app
  on `node:22`. Stage 2 is `python:3.14-slim`, installs
  `oxivault==0.2.1` via pip, copies the Node runtime from the official
  image plus the built app, and runs an entrypoint script that starts
  both processes and exits if either dies (`wait -n`). Health requires
  both: app `/healthz` and loopback oxivault `/vault`.

## Phase A: BFF (server-side foundation)

Each slice is vertically demoable via HTTP or a minimal page.

### A1. Skeleton, container, health

- **Tests first:** container build in CI; smoke test asserts `/healthz`
  returns app status including oxivault reachability; entrypoint kills
  the container if either child process exits.
- **Build:** SvelteKit scaffold, biome/vitest wired, Dockerfile,
  entrypoint, `/healthz` probing the loopback oxivault with the service
  token.
- **Demo:** `docker run` serves a placeholder page; killing uvicorn
  kills the container.

### A2. oxivault client module (`$lib/server/oxivault`)

- **Tests first (unit):** typed client against a fake HTTP layer —
  note CRUD passthrough, ETag/`If-Match` propagation, 409 conflict
  mapping, 404/400 surfaces, search/graph result typing, bearer token
  attached to every request.
- **Tests first (integration):** against real 0.2.1 with the fixture
  vault — full round-trip, conflict on stale ETag.
- **Build:** thin fetch wrapper + zod schemas for note payloads; no
  business logic.

### A3. Config, key builder, registries

- **Tests first:** env parsing fails closed (missing bucket pair,
  tokens, allowlist count mismatch); key builder produces canonical
  no-leading-slash keys from trusted metadata; rejects caller-supplied
  keys, wrong tier segments, bad slugs/IDs, traversal; place/event
  registries enforce 1:1 immutable mappings; lineage validation
  (edit/short require source episode, version, in-range seconds;
  recordings may not declare sources).
- **Build:** zod env schema; pure key-builder and validation modules
  (no I/O); registry fixtures loaded from `fixtures/`.
- This is the wrong-path defense from ADR-0003; it stays pure and
  heavily unit-tested.

### A4. Auth and sessions (ADR-0005)

- **Tests first (unit):** session cookie sign/verify/expiry; allowlist
  matching requires `email_verified=true`; role extraction; guard
  redirects; logout clears cookie; deny page for unlisted identities;
  rate limiter on auth routes.
- **Tests first (integration):** OIDC flow against a stub authorization
  server (the arctic client behind an interface; fake issuer, code,
  ID-token fixtures with and without `email_verified`).
- **Build:** `/auth/google/start|callback`, cookie sessions
  (`Secure`, `SameSite=Lax`, 12 h), `OAUTH_USER_<N>` allowlist loader,
  route guards for librarian surfaces. One documented manual test
  against real Google in dev; CI uses the stub only.

### A5. Catalog read endpoints (SSR data)

- **Tests first:** server `load` functions filter by `visibility`/
  `publication_state` for anonymous callers; published items resolve
  playback URLs from `public_object_key` (public custom domain);
  private/member items resolve presigned GET via loopback; drafts never
  leak to anonymous responses; search results are status-filtered.
- **Build:** read-only routes over the A2 client; playback URL
  resolver; OG metadata endpoint.

### A6. Ingest (librarian)

- **Tests first:** form-action validation with zod (all A3 rules
  enforced server-side); presigned PUT minted only for canonical keys
  built from submitted metadata; ffprobe report schema (codec H.264,
  AAC, duration, size) validated before `verified` is set; note created
  with conditional PUT (`If-None-Match: *`); duplicate slug yields 409.
- **Build:** ingest form actions; presign passthrough; upload-complete
  action recording the probe report.
- **Integration:** browser upload to MinIO presigned URL, then note
  readiness transition.

### A7. Pointer publish/unpublish state machine

- **Tests first (unit, in-memory S3 fake):** idempotent replay —
  pointer + verified target skips copy; copy/verify failure sets
  `publish_failed` with reason; success writes pointer then frontmatter
  under the propose-time ETag; stale ETag yields 409 and re-run
  converges; unpublish verifies private source before deleting public
  object and pointer; `publish_failed` clears on retry; never touches
  `vault/` prefix.
- **Tests first (integration, MinIO two buckets):** full
  publish/unpublish round-trip against real 0.2.1 note updates and real
  S3 copies.
- **Build:** server module using the app's own S3 client for
  cross-bucket copy/head/delete plus pointer objects; frontmatter
  updates via A2 conditional PUT; state enum transitions
  (`draft -> publishing -> published`, `publish_failed`).
- **Demo:** publish an episode fixture; observe public bucket object,
  pointer, frontmatter; unpublish restores private-only state.

### A8. Agent infrastructure (read tools only)

- **Tests first:** tool registry dispatch with role gating; tool errors
  map to typed `tool_result` events; SSE serializer produces the
  ADR-0004 message envelope (`token`, `tool_call`, `tool_result`,
  `evidence`, `final`, `error`); metering counts tokens per session;
  anonymous sessions hit rate limits before any provider call; the LLM
  provider sits behind an interface with a deterministic fake.
- **Build:** `$lib/server/agent` orchestration, read-only tools
  (`search_catalog`, `get_item`, `get_lineage`, `related_items`) over
  the A2 client, SSE route, per-session budget store.
- **Demo:** scripted fake-provider conversation exercises search tools
  and streams the envelope; no real provider key in CI.

**Phase A exit:** the container serves published fixture content
anonymously, supports librarian login (stub OIDC), ingest and publish
against MinIO, and a fake-driven agent stream. No UI polish yet; demos
are minimal pages and curl.

## Phase B: front-end

### B1. Reader browse/search/detail

- **Tests first (Playwright):** anonymous browse lists published
  episodes with tier and place; search filters by topic/teacher/place/
  tier; video detail plays the public MP4 (Media element + byte-range)
  and renders OG tags; drafts are absent from listing and direct URL.
- **Build:** SSR routes, design tokens, semantic HTML, list components,
  player component with presigned fallback for member content.

### B2. Login and librarian editing

- **Tests first:** login round-trip (stub OIDC in CI); unauthorized
  users never see editor routes; item editor round-trips frontmatter
  through form actions with inline zod errors; concurrent edit yields a
  visible 409 resolution flow; lineage editor enforces A3 rules with
  helpful messages.
- **Build:** login button/callback, editor forms, lineage editor,
  optimistic-concurrency conflict UI.

### B3. Publish dashboard and upload UX

- **Tests first:** dashboard shows `publication_state` enum correctly;
  publish button drives A7 and shows converged state after retry;
  upload with progress against presigned URL; failed probe shows
  conversion-required reason; unpublish confirms and reflects cache
  caveat copy.
- **Build:** dashboard, upload flow with resumable multipart for large
  files (R2 multipart), publish/unpublish actions with state polling.

### B4. Graph views (Svelte Flow)

- **Tests first:** ego-network endpoint returns node-capped subgraph
  (depth 2) typed payload; the graph route code-splits (JS budget test:
  graph deps absent from reader bundle); every related item is also in
  the accessible list view (a11y assertion); node click expands
  neighborhood via server round-trip.
- **Build:** `@xyflow/svelte` client-only component, deterministic
  tier/series-band layout, expand-on-click, list-view twin.

### B5. Agent panels

- **Tests first:** reader panel streams fake-provider tokens with
  evidence links; rate-limit response surfaces a friendly message;
  librarian panel renders a metadata patch diff and applies it via
  ETag-threaded conditional PUT; 409 during apply forces re-read and
  re-confirm; sanitized Markdown only (XSS probe test); no write tool
  executes without explicit confirm.
- **Build:** chat UI with collapsible tool traces, diff viewer,
  confirm/apply flow wired to A8 tools plus `propose_metadata_patch`,
  `validate_item`, `stage_publish`, `apply_patch`.

### B6. Budgets, accessibility, release

- **Tests first:** initial reader JS < 100 KB gzipped (CI check);
  axe-core passes WCAG 2.2 AA on core flows; keyboard-only walkthrough
  of browse, player, editor, graph list twin.
- **Build:** CSP headers, final trim, README run instructions,
  changelog, ADR status updates (0003/0004/0005 to Accepted on first
  live dev deployment).

## CI and delivery

- GitHub Actions (dev environment, ADR-0002 discipline): biome,
  svelte-check, vitest, integration (compose: MinIO + fixture vault),
  container build + smoke, image publish on tags. Secrets per ADR-0005
  (`GOOGLE_*`, `OAUTH_*`, `SESSION_SECRET`) and R2/S3 credentials for
  the app; all added only when their slice lands.
- Deployment target stays a single container on the dev host;
  scale-to-zero migration is a hosting change with no code impact.

## Risks

| Risk | Mitigation |
| --- | --- |
| Two runtimes in one image (Node + Python 3.14) bloat and complicate upgrades | Multi-stage build, pinned digests, container smoke test in CI; `adapter-cloudflare` + separate oxivault host remains the documented escape hatch |
| oxivault 0.2.1 auth semantics drift from ADR-0005 model (oxivault has its own roles) | BFF never forwards user identity to oxivault; integration tests pin 401/403 behavior against the released wheel |
| Publication helper and BFF pointer machine overlap/conflict | A7 owns publication; the 0.2.1 helper is used only for metadata updates, never copies; documented in code |
| R2 multipart upload from browser | B3 uses S3 multipart via presigned parts; validated in MinIO integration first |
| SSE through the reverse proxy buffered | Entrypoint and deploy docs require proxy buffering off on the agent route; covered by streaming integration test |

## Out of scope (explicitly)

- Stream publication slice, semantic search, S3/CloudFront, identity
  provider beyond Google OIDC, production promotion (separate ADR-0002
  approval).
