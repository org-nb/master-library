# ADR-0001 catalog Worker implementation

Built a local Cloudflare Worker scaffold for the D1-backed education catalog described in ADR-0001. It includes a typed Hono app, strict D1/R2 binding config, static asset fallback, and a minimal in-memory catalog with D1 query fallbacks and search routes.

The project lives in `workers/catalog/` and is ready for the next stage: live qualification through ADR-0002, when the authorized dev deployment can prove Stream, Queue, Vectorize, and R2 behavior against real Cloudflare resources.
