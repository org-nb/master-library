# ADR-0004: Design the SvelteKit front-end for catalog and agentic workflows

- **Status:** Proposed
- **Date:** 2026-10-04
- **Updated:** 2026-10-04: SvelteKit SSR server with co-located oxivault API in one container; agent orchestration moved into the app; Svelte Flow added for graph views
- **Authors:** Daniel Kapitan, Zed Agent
- **Depends on:** [ADR-0003](0003-use-oxivault-on-r2-for-video-catalog.md)
- **Amends:** ADR-0003's front-end hosting assumption (static SPA) and its browser-facing API auth/CORS requirements
- **Evaluation:** [Static SPA vs SvelteKit server](../../.agents/design/202610041551_spa-vs-ssr-agentic-evaluation.md)

## Context and Problem Statement

ADR-0003 establishes oxivault on R2 as the catalog backend. The
front-end needs a concrete architecture that supports two user groups:

- **Readers**: browse, search, and play published content, including
  exploring the network of related videos, people, topics and series.
- **Librarians**: manage metadata, lineage, visibility and publication.

The UI must also provide an **agentic interface linked to an LLM** to
help readers navigate content and help librarians maintain catalog data.

A design evaluation compared a static SPA against a SvelteKit server
and concluded that the agentic requirements, SEO for public teaching
pages, and browser security all favor a server-rendered front-end
acting as a backend-for-frontend (BFF). The remaining question was
operational: a second always-on server. That is resolved here by
co-locating the oxivault API **in the same container** as the
SvelteKit server, so there is only one app to deploy.

## Decision Drivers

- One deployable app, one container, one delivery surface.
- No model provider keys or catalog credentials in the browser.
- Crawlable public catalog pages with social previews (the content is
  meant to be found and shared).
- Agentic orchestration belongs in application code, not in oxivault
  (which stays a general-purpose vault store).
- Keep the runtime small and fast on low-power/mobile devices.
- Prefer stable, well-documented frameworks over fast-moving UI fashion.
- Accessibility first-class (keyboard, screen reader, reduced motion).
- Enforce strict role boundaries between reader and librarian
  operations; authoritative validation and mutations live in oxivault.

## Considered Options

1. **Static SPA** (`adapter-static` on Cloudflare Pages): simplest
   hosting, but no SSR/SEO, cross-origin auth complexity, and agent
   orchestration forced into oxivault core or a second browser-facing
   service. Rejected by the evaluation.
2. **SvelteKit SSR server in its own container, oxivault in another:**
   two deployables, two delivery surfaces, inter-container networking.
3. **SvelteKit SSR server with the oxivault API co-located in the same
   container** (chosen): one image, one deployment, loopback
   communication between the two processes.
4. **`adapter-cloudflare`** (SSR on the Workers runtime): no container,
   no cold starts, keeps delivery Cloudflare-only; requires the Node
   server process model to be replaced and Workers runtime limits
   verified. Viable fallback if container hosting becomes a burden.

## Decision Outcome

Chosen option: **3**. One container runs two processes:

- the **SvelteKit server** (`adapter-node`) as the only public-facing
  process: SSR, sessions, form handling, SSE streaming, agent
  orchestration, and server-to-server calls to oxivault;
- the **oxivault API** (uvicorn/FastAPI) bound to **loopback only**
  inside the same container, authorized by a static service token.

The browser talks to exactly one origin. oxivault is never exposed to
browsers, so it needs no CORS and no multi-user auth. The SvelteKit
server is a BFF: it owns presentation, sessions and orchestration, and
must not grow a second write path beside the oxivault API.

Svelte Flow (`@xyflow/svelte`) is the chosen component for visualizing
the network of related videos (see Graph views).

## Deployment architecture

```text
                     one container, one deployment
                    ┌─────────────────────────────────────────────┐
                    │  supervisor (entrypoint)                    │
                    │   ├─ SvelteKit server  (public port 3000)   │
                    │   │    sessions, SSR, SSE, agent loop       │
                    │   │    BFF rule: validation stays in oxivault│
                    │   └─ http://127.0.0.1:8000 ────────────┐    │
                    │                                      ▼      │
                    │   oxivault API (uvicorn, loopback only)     │
                    │        service-token auth                  │
                    │        Vault -> S3Store -> R2              │
                    └─────────────────────────────────────────────┘
   browser ───────one origin───────^ (TLS terminated in front)
   browser ──presigned PUT/GET──> R2 buckets (large media only)
   browser ──video bytes─────────> public R2 custom domain
```

### Process model

- Container entrypoint starts both processes and forwards signals
  (supervisord or a minimal entrypoint script; avoid a third process).
- Both processes must be health-checked; container is healthy only if
  both answer.
- oxivault binds `127.0.0.1` only; there is no port published for it.
- The SvelteKit server proxies nothing by default: its server code
  **calls** oxivault over loopback HTTP and renders or streams results.
  The only browser-to-backend bypass is presigned R2 upload/download
  URLs, by design, so media bytes never transit the app.

### Scale-to-zero and hosting

The container runs on any host: an always-on VPS, or a scale-to-zero
platform (Fly machines, Cloud Run) where the whole app wakes together.
Cold-start latency is a single wake-up, not UI-plus-API compounded.
At this catalog's traffic, cold starts are a non-driver; the hosting
choice can change without touching this architecture.

### Development mode

Local development runs `vite dev` and `oxivault serve` as two local
processes against a `LocalDirStore` with fixture notes and videos; the
BFF contract (loopback base URL plus service token) is identical to
production, so no code paths differ between dev and prod.

## Auth and sessions

- **Sessions live at the SvelteKit layer**: HttpOnly, `Secure`,
  `SameSite=Lax` cookies on the app's own origin. CSRF protection via
  SvelteKit origin checks on mutating form actions.
- **Readers are anonymous** for published content: browse, search,
  playback of published videos, and graph views need no login.
- **Librarians (and future members) log in with Google** via OIDC,
  authorized against a per-user allowlist provisioned as GitHub
  environment secrets. See [ADR-0005](0005-google-oidc-login-with-github-user-allowlist.md)
  for the flow, provisioning model and revocation semantics; the
  "operator-managed credentials" placeholder is superseded.
- **oxivault auth is a static service token** on the loopback hop,
  held only in the container's environment. If a second API consumer
  ever appears (CLI, integration), oxivault gains real multi-user auth
  then, not speculatively.
- The reader agent panel is anonymous but **rate-limited and metered**
  (see Agentic interface) so it cannot become a public LLM faucet.
- Presigned R2 URLs are short-lived and scoped to canonical keys built
  by the server; the browser never supplies object keys.

## Agentic interface

### Orchestration location

Agent orchestration lives in **SvelteKit server-only modules**
(`$lib/server/agent`): session handling, LLM provider calls, tool
execution against the loopback oxivault API, streaming, metering and
audit. oxivault stays a generic vault store; the ADR-0003 extension
list does not grow agent endpoints.

### Interaction model

- Transport: same-origin **SSE**. With cookie sessions, native
  `EventSource` works; where header-based requests are used, fall back
  to `fetch` + `ReadableStream` parsing. The TLS terminator in front of
  the container must not buffer the agent route.
- Message types: `token` (stream chunk), `tool_call`, `tool_result`
  (summarized server-side before display), `evidence`, `final`,
  `error`.
- The tool loop (LLM -> tool -> LLM) runs entirely server-side; only
  display-bound events reach the browser.

### Role boundaries and tools

- Reader role: read-only tools (`search_catalog`, `get_item`,
  `get_lineage`, `related_items`).
- Librarian role: adds `propose_metadata_patch`, `validate_item`,
  `stage_publish`, `apply_patch`.
- The API (oxivault) enforces authorization via the service boundary;
  UI role checks are convenience only.
- Write tools must call the exact ADR-0003 pointer-publish and
  note-update operations; the agent layer has no independent write
  path.

### Patch contract

- `propose_metadata_patch` reads the note, records its **ETag**, and
  returns a structured frontmatter diff (JSON Patch over frontmatter)
  for review.
- `apply_patch` applies the diff as a **conditional whole-note PUT**
  (`If-Match` with the propose-time ETag). A 409 conflict means the
  note changed in between: the UI re-reads, re-diffs and re-confirms.
  This works against oxivault as it exists today; an upstream
  `PATCH /notes/{path}` is an optional later refinement, not a
  dependency.

### Safety, audit, and cost control

- Diff preview before every apply; no auto-applied suggestions.
- Every agent-assisted mutation is logged with actor session, tool,
  request ID and applied ETag.
- Per-session LLM token metering with a configurable budget; anonymous
  reader sessions get strict rate limits (per IP and per session)
  enforced before any provider call is spent.
- Model provider and model selection are server-side configuration.
- Agent output is rendered as **sanitized Markdown only** (no raw
  HTML); evidence links are validated against catalog URLs; a CSP
  restricts the app. Tool traces show summaries, not raw payloads.

## UI composition

### Reader surfaces

- Home and topic browse; search results with filters (topic, teacher,
  place, tier); SSR'd and crawlable with Open Graph tags on video
  pages.
- Video detail page with playback and lineage context (source
  recording, derived edits/shorts), plus a plain list of related items.
- **Graph view** (Svelte Flow): interactive network of related videos.
- Agent panel (reader mode): natural-language discovery, reading-list
  suggestions, evidence links back to catalog items.

### Graph views with Svelte Flow

[Svelte Flow](https://svelteflow.dev) (`@xyflow/svelte`, MIT-licensed
core from the xyflow team) renders the catalog's relationship network:
nodes for recordings, edits, shorts, people, topics and series; edges
from the vault's RDF relationships (`po:subject`, `po:credit`, series
membership, lineage `prov:wasDerivedFrom`).

- **Data**: the SvelteKit server builds an **ego-network subgraph**
  (focal video, depth 1-2, node-capped) from oxivault graph queries and
  ships a typed JSON payload. The browser never queries the graph
  directly. Deeper neighborhoods load on node click ("expand").
- **Layout**: Svelte Flow has no built-in auto-layout; start with a
  simple deterministic placement (group by series/tier bands) and add
  elkjs or dagre only if a measured need appears.
- **Performance**: the component is client-only (guarded import,
  `{#if browser}`) and route-level code-split; reader pages without the
  graph view never download it. Viewport-only rendering keeps
  hundreds of nodes smooth.
- **Accessibility**: a graph is never the only path to related content.
  Every graph view is paired with an equivalent, fully keyboard- and
  screen-reader-accessible list view; the graph is an enhancement.
- **Alternatives considered**: cytoscape.js, sigma.js, vis-network
  (framework-agnostic but not Svelte-native), custom d3-force
  (unbounded build cost). Svelte Flow wins on first-class Svelte
  support, maintained core, built-in pan/zoom/selection, and Pro
  features we do not need remaining cleanly optional.

### Librarian surfaces

- Catalog item editor over frontmatter fields, using SvelteKit form
  actions with zod validation (server-side pre-validation; oxivault
  remains authoritative). No form-helper framework dependency.
- Lineage editor for `recording` -> `edit`/`short` relationships.
- Visibility/publication controls and a publish-state dashboard
  (`draft`, `publishing`, `published`, `publish_failed`,
  `unpublishing`), showing ADR-0003 pointer-publish outcomes.
- Agent panel (librarian mode): metadata cleanup suggestions, lineage
  consistency checks, publication readiness checks, patch proposals
  with explicit approve/apply.

## Extension and framework evaluation

| Area | Recommended now | Alternatives | Rationale |
| --- | --- | --- | --- |
| App framework | SvelteKit + `adapter-node` | `adapter-static`, `adapter-cloudflare` | SSR/SEO, one-origin BFF, single container; adapter-cloudflare remains a fallback |
| Styling | Native CSS + design tokens | Tailwind, component libraries | Lowest dependency and build complexity |
| Forms | SvelteKit form actions + zod | sveltekit-superforms | Server actions exist now; avoid the extra dependency and its churn risk |
| Data fetching | SvelteKit `load` (server) | TanStack Query, client stores | Server `load` hides the API and its credentials from the client |
| Graph visualization | Svelte Flow (`@xyflow/svelte`) | cytoscape.js, sigma.js, d3-custom | Svelte-native, MIT core, built-in interaction; ego-networks keep it small |
| Agent transport | same-origin SSE | WebSockets | One-way streaming; simpler reconnection; cookie-auth compatible |
| LLM orchestration | app server modules | oxivault endpoints, separate agent service | Keeps oxivault generic; no extra deployable or browser origin |

## Performance and stability constraints

- Reader routes: **< 100 KB gzipped initial JS**; checked in CI.
- Graph and agent routes are code-split; agent panel loads after
  first paint (progressive enhancement).
- SSR responses use conditional requests/ETags from oxivault so
  repeated views stay cheap.
- Track Web Vitals and API latency in dev and prod.

## Accessibility constraints

- Target **WCAG 2.2 AA**; verified with an automated axe pass in the
  Playwright suite plus manual keyboard/screen-reader review of core
  flows.
- Semantic form controls with inline validation messages.
- Every graph view has an equivalent list view (above).
- Agent output exposes source links; suggestions are never
  auto-applied.

## API contracts required from oxivault

The consumer of all of these is the **SvelteKit server over loopback**,
not the browser:

1. Static service-token auth (loopback only; no CORS needed).
2. Catalog read/write endpoints for notes, search, lineage and publish
   state (ADR-0003 pointer operations).
3. Graph query endpoints sufficient to build ego-network subgraphs
   (`/graph/edges`, `/search`, SPARQL).
4. Presigned PUT/GET URL minting for R2.
5. Typed error codes the BFF can map to user-facing messages and the
   agent can map to `tool_result` events.

## Consequences

- Good: one deployable app; one origin for the browser; no CORS, no
  tokens in JavaScript, standard cookie CSRF model.
- Good: SEO and share previews for public teaching pages.
- Good: agent orchestration lives with the UI that renders it; oxivault
  stays generic; tool loop and metering stay server-side.
- Good: static SPA's auth and streaming complications (finding 2 and 3
  of the ADR-0004 review) dissolve rather than get engineered around.
- Bad: two runtimes (Node + Python) in one image; the image is larger
  and the entrypoint owns process supervision. Acceptable for one
  deployment unit.
- Bad: the SvelteKit server is now a dependency of every page; it is
  stateless and restartable, and published video URLs keep working
  from R2 regardless.
- Bad: a container cannot share Cloudflare's free static hosting; the
  app runs where the container runs (or moves to `adapter-cloudflare`
  plus an oxivault host later).
- Bad: BFF discipline must be enforced in review; server `load` code
  that starts duplicating oxivault validation is the drift signal.

## Rollout

1. Container scaffold: two-process entrypoint, loopback wiring,
   service-token auth, health checks; dev mode with fixtures.
2. Reader browse/search/playback views (SSR, Open Graph).
3. Auth slice: OIDC login per ADR-0005 protecting all librarian
   surfaces.
4. Librarian metadata and lineage editing via form actions.
5. Publication state controls over the ADR-0003 pointer operations.
6. Graph views with Svelte Flow (ego-networks, list-view fallback).
7. Reader-mode agent panel (read-only tools, rate limits, metering).
8. Librarian-mode agent panel (patch preview, ETag-threaded apply,
   audit log).
9. Measure payload, performance and accessibility budgets; trim.

## References

- [ADR-0003: Use oxivault on R2 for the video catalog](0003-use-oxivault-on-r2-for-video-catalog.md)
- [ADR-0004 review](../../.agents/review/202610041130_review-adr-0004.md)
- [Static SPA vs SvelteKit server evaluation](../../.agents/design/202610041551_spa-vs-ssr-agentic-evaluation.md)
- [SvelteKit documentation](https://svelte.dev/docs/kit)
- [Svelte Flow](https://svelteflow.dev)
- [Server-Sent Events specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [JSON Patch (RFC 6902)](https://datatracker.ietf.org/doc/html/rfc6902)
