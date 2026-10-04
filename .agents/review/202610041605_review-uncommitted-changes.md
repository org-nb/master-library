# Review: all uncommitted changes since be9bf07

**Date:** 2026-10-04
**Scope:** Full working-tree diff against `be9bf07` (`docs(adr): update
ADR-0003 for container/VPS hosting and private-by-default R2 media`):
the ADR-0003 pointer-pattern revision, the ADR-0004 rewrite
(single-container SvelteKit server, Svelte Flow, agent layer), ADR-0005
(Google OIDC allowlist auth), the SPA-vs-SSR evaluation, the ADR-0004
review, README updates, and index/memory updates.
**Gate:** `tara check` passes; all changes staged.

**Resolution (2026-10-04):** all findings applied. Publish/unpublish rewritten as a pointer-keyed idempotent state machine and the private source is never deleted (findings 1-2); Consequences restored (3); keys normalized to no leading slash (4); event identity specified and registry freeze folded into the rollout (5); `po:Place` wording made snapshot-verified with `nb:Place` fallback (6); context terms aligned to frontmatter names with `private_object_key`/`public_object_key` (7); `publish_failed` transition, pointer-removal ordering, identity-levels wording and vault bucket naming fixed (8); `email_verified` required in ADR-0005 (9); design doc marked partially superseded and README annotated (10-11).

## Overall

The architecture is coherent end to end: one container, one browser
origin, loopback oxivault, pointer publication, tier lineage, Google
OIDC with deploy-time allowlist. Cross-references between ADR-0003,
ADR-0004 and ADR-0005 resolve correctly, and the publish-state enum,
pointer operations and extension list are consistent across documents.
The findings below are in the ADR-0003 revision's new mechanics
(pointer pattern, key convention, lineage model) plus two smaller gaps
in ADR-0005 and the docs scaffolding. None change the chosen
architecture; several change the specified procedure.

## Findings

### ADR-0003 (pointer-pattern revision)

**1. Publish recovery flow is wrong after the source delete — major.**
The rollback section says "if step 6 fails after copy, rerun publish;
operation must converge". But step 5 deletes the private source before
step 6 updates metadata. A rerun after a step-6 failure starts at step 1
and fails: `CopyObject` has no source. The pointer (written at step 4)
is the only recovery record, so the specified rerun must begin by
reading the pointer: if present and `HeadObject` verifies the target,
skip copy/delete and complete the metadata update. The same resumable
state machine is needed for unpublish ("performs the inverse" is too
thin to implement). Recommend rewriting "Rollback and recovery" as an
explicit idempotent state machine keyed on pointer existence and target
verification.

**2. Publishing destroys the only private copy — major, unstated
trade-off.** Step 5 deletes the private playback object, so after
publish the video bytes exist only in the publicly accessible bucket.
Consequences the ADR does not acknowledge: there is no preserved master
(the earlier design kept originals privately; re-encodes must fetch
from the public bucket), and unpublish cannot truly revoke access
(Cloudflare cache and any saved URL keep serving until purged/expired).
The storage saving is real but small; the ADR should either state these
consequences and accept them, or retain a `master` object under a
non-playback key that publication never deletes. Also state that
unpublish requires a cache purge (or an explicit cache-TTL policy) for
revocation to be meaningful.

**3. The Consequences section was deleted — major structural gap.**
The revision removed the entire "Consequences" block. An ADR without
stated trade-offs loses the record of what was accepted: oxivault
cannot run on Workers, no relational constraints, publication semantics,
plus the new pointer trade-offs from findings 1-2. Restore a
Consequences section for the revised decision.

**4. Leading-slash key inconsistency — medium.** The root-path rule and
all key templates start with `/YYYY/...`, but the pointer JSON example
uses `"2026/bodhgaya/..."` without a leading slash. S3/R2 keys
conventionally have no leading slash (a leading one creates an empty
path segment and breaks naive joining). Pick one — recommend no leading
slash in actual keys, with the templates' `/` marked as display-only —
and make the future key-builder extension (extension 3) normative on it.

**5. Event identity is load-bearing but unspecified — medium.** Key
templates require `event-id` and `event-slug`, and the lineage model
puts `event (po:Series)` at the top, but no section defines where event
records live (note type? registry like the place registry?), who
assigns `event_id`, or its validation. The place registry gets a
dedicated freeze step in the rollout; events need the same treatment or
keys cannot be built.

**6. `po:Place` is asserted but unverified — medium.** The place-slug
maps to "a unique BBC Programmes ontology place (`po:Place`)". Verify
`po:Place` exists in the pinned IPTC snapshot before making it
load-bearing (the ADR-0001 discipline was to pin and test the profile,
not to invent terms). If it is absent, use a local term or an external
place vocabulary (GeoNames, `schema:Place`) and keep `place_slug`
mapping 1:1 regardless.

**7. Frontmatter-to-context naming mismatch — medium.** Frontmatter and
identity fields are snake_case (`place_iri`, `publication_state`,
`private_key`); the `context.jsonld` terms are camelCase (`placeIri`,
`publicationState`, `privateKey`) with no stated mapping rule. oxivault
derives RDF properties from frontmatter, so either the context must use
the frontmatter names or a normalization rule must be specified.
Separately, `privateKey`/`publicKey` as RDF terms read as cryptographic
keys; rename to something like `nb:r2PrivateObjectKey` /
`nb:r2PublicObjectKey` (or `storageKey`) before the context is frozen.

**8. Smaller gaps in the same file — minor.**
- `publish_failed` appears in the state enum but no transition ever sets
  it; define when it is written (copy/verify failure, timeout?) and how
  it clears.
- Unpublish should state that the pointer is removed only after the
  private copy is verified.
- "Keep ADR-0001's three identity levels" is misleading: the asset
  level is actually dropped (one playback object per version); say so
  instead.
- The vault notes bucket is outside the naming convention; give it a
  `master-library-vault-<env>` name in the same section.

### ADR-0005 (Google OIDC)

**9. `email_verified` claim check not explicit — minor, but fix.** The
flow "reads the verified email" and verifies issuer/audience/nonce, but
never requires checking the ID token's `email_verified=true` claim
before the allowlist match. A Google account with an unverified email
must never match the allowlist. One sentence fixes it.

### Scaffolding

**10. Known drift still open — minor (tracked).** The session design
doc `.agents/design/202610041026_oxivault-r2-catalog-design.md` still
carries the pre-pointer frontmatter schema (`versions`/`master`/
`published_key`) and a two-bucket model; README still links it as a
current design. Reconcile or mark superseded (ADR-0004 review finding
9).

**11. README ADR-0003 bullet — minor.** The status bullet still
describes "direct R2 video delivery" without the private-by-default and
pointer-publish nuance the committed direction now has; a one-line
refresh keeps the README honest.

## What checks out

- ADR-0004 is internally consistent after the revision: the publish
  dashboard enum matches ADR-0003, the agent `stage_publish`/`apply_patch`
  tools delegate to the pointer operations, rollout renumbers correctly
  (9 steps), and the review findings 1-3, 5, 6 resolutions hold.
- ADR-0005's allowlist model, secret naming, provisioning runbook and
  revocation semantics are coherent with ADR-0002's environment
  discipline and ADR-0004's session model.
- Indexes (design, review, memory) are current; memory notes record both
  decisions and open items; `tara check` green.

## Recommended order of fixes

Findings 1-3 (ADR-0003 procedure, preservation trade-off, consequences)
before any implementation planning; 4-7 alongside the place/event
registry freeze in rollout steps 2-3; 9 and 11 immediately; 10 whenever
the design doc is next touched.
