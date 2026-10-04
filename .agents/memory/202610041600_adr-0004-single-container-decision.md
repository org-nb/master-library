# ADR-0004 revision: single-container SvelteKit server + Svelte Flow

2026-10-04, design-only session.

## Decision

Developer chose the SvelteKit server option with the oxivault API
co-located in the same container (one deployable, one browser origin).
ADR-0004 rewritten accordingly; all six review findings fixed:

- adapter-static -> adapter-node SSR (SEO finding resolved).
- Auth: same-origin HttpOnly cookie sessions at the app layer; oxivault
  reduced to a loopback static service token; readers anonymous.
- superforms dropped (form actions + zod).
- Agent orchestration moved into SvelteKit server-only modules;
  oxivault stays generic.
- Patch contract defined: JSON Patch proposal + ETag-threaded
  conditional PUT apply.
- SSE same-origin; EventSource viable with cookies.
- Minors included: sanitized agent output + CSP, <100 KB reader JS
  budget, WCAG 2.2 AA + axe, LLM per-session metering and anonymous
  reader-agent rate limits.

Svelte Flow (`@xyflow/svelte`) added for related-video network views:
server-built ego-network subgraphs, client-only and code-split, with a
mandatory list-view fallback for accessibility.

## ADR-0003 amendments

Context bullet, architecture diagram, extensions list (auth -> loopback
service token, CORS dropped, list renumbered 1-6) and rollout step 1
updated for the co-located container. These rode on the developer's
uncommitted ADR-0003 pointer-pattern revision.

## Still open

- Finding 9 housekeeping: `.agents/design/202610041026_oxivault-r2-catalog-design.md`
  frontmatter schema/publish flow predates the committed ADR-0003
  pointer and tier model; needs reconciliation.
- Container entrypoint choice (supervisord vs script) decided at
  implementation.
- Librarian identity provider deferred.

No code or deployment ran. Suggested commit message:
`docs(adr): decide single-container SvelteKit server with co-located oxivault API`
