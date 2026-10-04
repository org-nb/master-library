# oxivault-R2 design update handoff

2026-10-04, design-only session.

## What changed

ADR-0003 (Proposed) replaces the ADR-0001 D1 catalog with:

- oxivault vault on private R2 via `S3Store` as the authoritative catalog.
- Svelte front-end talking to the oxivault HTTP API (static build, e.g.
  Cloudflare Pages).
- Videos served directly from a public R2 bucket (custom domain); masters
  stay in a private bucket; publication is the access boundary.
- Cloudflare Stream kept as an explicit per-video publish action, no
  webhooks or reconciliation.

New design doc: `.agents/design/202610041026_oxivault-r2-catalog-design.md`
(full architecture, frontmatter schema, flows, impact review, risks,
open decisions, rollout). ADR-0001 marked superseded (BBC profile
guidance retained); ADR-0002 scope revised (API host is off-Cloudflare);
README and epic annotated; design index updated.

## Key review findings

- oxivault (Python 3.14, FastAPI, boto3, RDFLib, Polars) cannot run on
  Cloudflare Workers; the API needs a container host. Delivery is no
  longer Cloudflare-only.
- oxivault HTTP API currently has no auth, no CORS, no presigned-URL
  support: four upstream extensions are blocking, listed in the design.
- Direct R2 delivery means no per-request access control; restricted
  content must never enter the public bucket.
- `workers/catalog` D1 scaffold has no consumer under ADR-0003;
  retirement pending developer decision.

## Open decisions for the developer

API host choice, auth mechanism (static tokens recommended first),
workers/catalog deletion, media custom domain, publication copy in API
vs operator job.

## Next steps

1. oxivault upstream: auth, CORS, presign_put.
2. Dev slice: local `oxivault serve` + Svelte UI against fixtures.
3. R2 slice: vault/masters/media buckets; then publish slice; Stream last.

No code, deployment or migration ran; no commit made. Suggested commit
message: `docs: design oxivault-on-R2 catalog (ADR-0003), supersede D1 decision`
