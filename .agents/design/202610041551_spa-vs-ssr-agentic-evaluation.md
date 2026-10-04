# Evaluation: static SPA vs SvelteKit server for catalog and agentic workflows

**Project:** Master Library
**Date:** 2026-10-04
**Status:** Superseded by the ADR-0004 decision: SvelteKit server with the oxivault API co-located in the same container
**Related:** [ADR-0003](../../docs/adr/0003-use-oxivault-on-r2-for-video-catalog.md), [ADR-0004 draft](../../docs/adr/0004-design-sveltekit-frontend-for-catalog-and-agentic-workflows.md), [ADR-0004 review](../review/202610041130_review-adr-0004.md)

## Question

Should the front-end be a **static SPA** (`adapter-static` on Cloudflare
Pages) or a **SvelteKit server** (`adapter-node` in a container that can
scale to zero, co-located with or beside the oxivault API host)? The
evaluation must explicitly weigh **agentic workflows in the UI**, which
is the requirement most sensitive to this choice.

A third variant is noted where relevant: SvelteKit SSR via
`adapter-cloudflare` (Pages Functions / Workers runtime), which is a
"SvelteKit server" without a container.

## The structural difference

With a static SPA, the browser talks **directly** to every backend
origin: oxivault API for catalog data, and whatever service runs agent
orchestration. Every such origin needs CORS, browser-safe auth, and
streaming-friendly headers.

With a SvelteKit server, the browser talks to **one origin**: the
front-end server. It renders HTML, holds server-side sessions, and acts
as a backend-for-frontend (BFF) that calls oxivault (and the LLM
provider) server-to-server. No CORS anywhere, no tokens in the browser.

## Comparison

| Dimension | Static SPA | SvelteKit server (container, scale-to-zero) |
| --- | --- | --- |
| Hosting/ops | Cloudflare Pages, zero servers to patch | Second container beside the oxivault API host; marginal ops cost is low if co-located, but it is a real process to deploy, monitor and patch |
| Cost | Free tier comfortably covers it | Near-zero on scale-to-zero platforms (Fly machines, Cloud Run); an always-on VPS already paid for the API host makes it effectively free |
| Cold starts | None | 0.3-2 s wake on first request after idle; compound with a cold API host if both scale to zero |
| SEO / shareability | None: client-rendered pages are not crawlable; no reliable Open Graph previews for shared teaching links | Full SSR/prerender: crawlable catalog, social embeds for videos |
| Auth model | Cross-origin: `SameSite=None` cookies + CSRF defenses, or bearer tokens in JS with XSS/refresh handling; every backend origin must implement CORS + auth for browsers | Same-origin HttpOnly session cookies; standard CSRF model; oxivault API can even drop browser-facing auth entirely and accept only the front-end server's service identity |
| Read performance | Global CDN for the shell, but every catalog view is client-rendered after API round-trips (cross-origin) | Server round-trip per view, but responses can be cached at the edge; no cross-origin waterfall; smaller client JS |
| Failure modes | Front-end survives API outage (shows error states) | Front-end server is a dependency of every page; but it is stateless and restartable, and published video URLs keep working from R2 regardless |
| Agentic workflows | See below: workable but every weakness above is amplified | See below: the natural home for orchestration |

## Agentic workflows: SPA vs server

This is the decisive dimension. Break the agent panel into its parts:
session/identity, orchestration loop (LLM + tool calls), streaming to
the browser, tool execution against the catalog, and cost control.

### Where orchestration lives

- **SPA:** the ADR-0004 draft puts orchestration in oxivault. The
  review flagged this as a scope question: oxivault is a general-purpose
  OSS vault store, and baking Master Library agent endpoints into it
  couples its roadmap to this application. Moving orchestration to a
  separate agent service instead means the SPA now needs a **second
  browser-facing origin** with its own CORS, auth and streaming
  configuration. Every architecture option that avoids polluting
  oxivault makes the SPA's browser surface wider.
- **SvelteKit server:** orchestration lives in **server-only modules of
  the app itself**. This cleanly resolves the review's finding: the
  agent layer is application code living in the application, oxivault
  stays a generic catalog API, and the browser still sees one origin.
  SvelteKit explicitly supports this split (`$lib/server`, no client
  bundles for server modules).

### Streaming

- **SPA:** browser streams directly from the agent endpoint.
  `EventSource` cannot send auth headers, so streaming must be
  fetch/ReadableStream with CORS preflight sustained across a long-lived
  response; reconnects after token refresh are fiddly.
- **SvelteKit server:** same-origin SSE (or streaming HTML) with
  standard cookies; the server holds the provider connection. It can
  also transform the stream server-side: filtering tool payloads before
  display, merging evidence lookups, rendering partial HTML instead of
  shipping tokens for client-side Markdown parsing.

### Tool execution

- **SPA:** tool calls execute where the orchestrator lives (oxivault or
  a separate service). Either way the browser must be authorized for
  those endpoints, and every tool result transits the browser even when
  only a summary is displayed.
- **SvelteKit server:** the tool loop runs entirely server-side
  (orchestrator -> oxivault API -> back), with only `token`/`evidence`
  events reaching the browser. Fewer round-trips, no browser-visible
  write endpoints, and the write tools (`apply_patch`, `stage_publish`)
  can require a server-verified session instead of a bearer token in JS.

### Sessions, audit, and cost control

- **SPA:** conversation state must live in the API/agent service keyed
  by a client-held token; per-user LLM rate limiting must be enforced at
  the API per token; an anonymous reader agent panel becomes an
  unmetered public LLM endpoint.
- **SvelteKit server:** sessions are first-class (cookie-bound), audit
  logs and per-session cost metering live next to the requests they
  describe, and reader-mode agent access can be gated or metered at one
  place before any provider call is spent.

### Verdict on agents

Agentic workflows favor the server option decisively, not because an SPA
cannot do them, but because every alternative arrangement (agent in
oxivault core, separate agent service) either couples the wrong
component or widens the browser's attack and CORS surface. The BFF shape
also restores options the review had to reject: with server form
actions, `sveltekit-superforms` becomes viable again (though plain forms
remain fine), and the patch/apply flow can be an authenticated form
action that threads ETags server-side.

## Scale-to-zero reality check

Scale-to-zero only pays off if the **whole request path** can sleep:

- The oxivault API host (ADR-0003, container/VPS) must be awake for any
  catalog read or agent tool call regardless of the front-end choice.
- If the API is an always-on VPS, co-locating the SvelteKit server there
  makes "scale to zero" moot: the marginal cost is one more process.
- If the whole stack moves to a scale-to-zero platform (Fly/Cloud Run),
  a cold reader request pays UI wake-up **and** API wake-up serially.
- The Cloudflare variant avoids this entirely: `adapter-cloudflare` runs
  SSR on the Workers runtime with effectively no cold-start penalty,
  true scale-to-zero, and no container. Constraints: no Node-only APIs
  and Workers CPU limits (streaming proxy work fits comfortably; heavy
  per-request computation does not). It would also make delivery
  Cloudflare-only again, which ADR-0003 gave up.

For a low-traffic teaching library, cold starts are a minor concern
either way; they should not drive the decision. Where the agent loop
runs and how auth works should.

## Recommendation

Choose the **SvelteKit server**. Concretely:

1. **Preferred:** `adapter-node` container co-located with the oxivault
   API on the existing host (or the same scale-to-zero platform if the
   stack migrates). Simplest mental model, one deployment story,
   agent orchestration in app code.
2. **Equally valid if Cloudflare-only delivery is preferred:**
   `adapter-cloudflare`. Same BFF properties, no container, no cold
   starts; verify streaming SSE and the oxivault client work within
   Workers runtime limits during the dev slice.

Keep `adapter-static` only if both SEO and the agent panels were
deprioritized, which contradicts the current product direction.

### Consequences for ADR-0004 (revises the review findings)

- Finding 6 (SEO trade-off): resolved by changing the adapter decision.
- Finding 2 (auth model): becomes same-origin HttpOnly cookies; oxivault
  API auth simplifies to a service identity for the front-end server
  (plus any direct operator/CLI use).
- Finding 5 (agent backend scope): resolved by moving orchestration into
  SvelteKit server-only modules; oxivault stays generic; ADR-0003's
  extension list stays as committed.
- Finding 1 (superforms): unblocked but optional; plain forms + zod
  remain acceptable.
- Finding 3 (EventSource): same-origin SSE still needs fetch-streaming
  if Authorization is used, but with cookie sessions `EventSource`
  works as-is; either way streaming is simpler than in the SPA case.
- Finding 4 (patch contract): unchanged; still needs an upstream
  `PATCH /notes/{path}` or an ETag-threaded conditional-PUT rule.
- New rule to write into ADR-0004: the SvelteKit server is a BFF only;
  authoritative validation and mutations stay in the oxivault API. The
  agent layer may call the API but must not grow a second write path.
