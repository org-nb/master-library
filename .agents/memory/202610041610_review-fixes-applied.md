# Review-fix handoff: post-be9bf07 findings applied

2026-10-04, docs-only session.

## What changed

All 11 findings from `.agents/review/202610041605_review-uncommitted-changes.md`
applied; resolution recorded in the review doc.

ADR-0003 (major rework of the pointer mechanics):

- Publish/unpublish rewritten as a pointer-keyed idempotent state
  machine: reruns verify pointer + public object before any copy;
  `publish_failed` transition defined; pointer removed only after the
  private source is confirmed present.
- **Design change:** the private source object is never deleted.
  Publish is copy-only. Published items occupy both buckets; accepted
  for archival preservation, trivial idempotency, and unpublish without
  copy-back. Unpublish documents the cache-purge/TTL revocation caveat.
- Consequences section restored with the current trade-offs.
- Keys normalized to no leading slash everywhere.
- Event identity specified (`po:Series` notes, immutable `event_id`);
  place and event registry freeze combined in rollout step 2.
- `po:Place` wording now requires snapshot verification with
  `nb:Place` fallback.
- context.jsonld terms aligned to snake_case frontmatter names;
  `private_object_key`/`public_object_key` replace `private_key`/
  `public_key`; identity-field list updated to match.
- Vault notes bucket added to the naming convention
  (`master-library-vault-<env>`); "three identity levels" wording
  corrected (asset level dropped).

ADR-0005: `email_verified=true` now required before allowlist match.

Scaffolding: session design doc marked partially superseded with a
header note; README ADR-0003 bullet refreshed (private-by-default,
pointer publication) and design-doc link annotated.

## Developer note

The never-delete change modifies the Zed-agent pointer design: storage
duplication for published items was traded for preservation and simpler
convergence. Flag at commit review if you prefer the original
delete-on-publish behavior with the state-machine fix only.

Suggested commit message:
`docs(adr): apply review fixes to pointer publication, lineage and auth`
