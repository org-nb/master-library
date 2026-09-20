# Master Library catalog worker

This Cloudflare Worker implements the ADR-0001 catalog boundary: a D1-backed editorial catalog with a typed Hono API, private R2 transcript storage, static asset fallback, and a search surface that defaults to safe local sample data when no D1 binding is configured.

## Local development

```bash
pnpm install
pnpm run dev
```

Visit http://localhost:8787 to open the catalog UI. The API routes are served by the Worker before static assets, so `/api/*` requests remain available even when the SPA fallback is active.

## Core routes

- `GET /api/health` - worker health and binding status
- `GET /api/videos` - paginated public catalog listings
- `GET /api/videos/:id` - single-video lookup
- `GET /api/search?q=...` - keyword search using the D1 query path when present

## Production notes

The `wrangler.jsonc` file declares the D1 and R2 bindings required by ADR-0001. The example database names are placeholders, and real deployment must be paired with an authorized Cloudflare account setup and a migration plan before production activation.
