# Implementation plan handoff

2026-10-04, planning session.

## What changed

- New plan: `.agents/plan/202610041648_bff-frontend-implementation.md`.
  TDD, single deployable container, Phase A (BFF, A1-A8) before Phase B
  (front-end, B1-B6). Supersedes the ADR-0001 multi-backend plan in the
  index.
- ADR-0003 amended for the new inputs:
  - Vault notes now live under the `vault/` prefix of the shared
    private media bucket (was a dedicated bucket). Added rule: never
    mint presigned URLs for `vault/` keys, since R2 credentials are
    bucket-scoped.
  - Extensions section rewritten against oxivault 0.2.1 (PyPI): auth
    and presign are delivered upstream; key builder, registries,
    lineage validation and the cross-bucket pointer state machine are
    BFF application logic. Rollout step 1 pins 0.2.1.

## oxivault 0.2.1 findings driving the plan

- Ships OAuth2 bearer/session auth (`read`/`editor`), CORS config,
  presigned URL endpoints, and a publication helper
  (`/publication/notes/{path}`) doing metadata updates plus same-store
  prefix copies.
- Gap: no cross-bucket copy with pointer objects, no canonical key
  builder, no lineage/registry validation, no OIDC, no agent layer.
  The plan assigns all of these to the BFF (Node) and pins behavior
  with integration tests against the released wheel and MinIO.

## Next session should start at

Plan slice A1 (skeleton/container/health) once the plan is approved.
