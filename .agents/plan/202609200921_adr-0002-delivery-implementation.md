# Implement ADR-0002: isolated Cloudflare delivery

Status: Draft implementation plan. Publishing this document does not authorize
pipeline implementation, deployment, or changes to shared infrastructure.

Target ADR: [ADR-0002](../../docs/adr/0002-isolate-dev-and-prod-delivery.md).
Application prerequisite: [ADR-0001](../../docs/adr/0001-use-d1-for-video-catalog.md).
Links above are relative to the intended `.agents/plan/` publication location.

## Goal and scope

Deliver the real catalog Worker through GitHub Actions into separate existing
Cloudflare dev and prod accounts. Keep infrastructure, runtime configuration,
migrations, workflows and operational procedures as code. Build once on protected
main, qualify in dev, then promote the identical code artifact through a protected
release tag and production approval.

The user confirmed that both accounts exist and that the ADR-0001 catalog Worker
must be implemented before delivery work begins. Do not introduce a placeholder
Worker, implement the catalog as part of this plan, or silently accept either ADR.
Secrets, state, full plans and application data stay outside the public repository.

## Baseline and prerequisites

No delivery workflows, OpenTofu roots or active catalog Worker package/config were
found. The root Python package is a scaffold; Tara is available in `.venv/bin/tara`
and currently configured for Python. Pre-commit declares actionlint, zizmor and
gitleaks, but their presence is not proof that a complete delivery gate exists.
Existing staged documentation and unrelated deleted/untracked files must be preserved.

Before implementation, require a reviewed catalog Worker with explicit bindings,
versioned D1 migrations, local runtime tests, an authenticated admin contract,
non-destructive health checks and a representative synthetic integration fixture.
Require maintainer acceptance of applicable ADRs without changing their status
implicitly. Read the final Worker interfaces rather than guessing from the ADR.

Account IDs, DNS zones/domains, existing resources, webhook subscriptions, billing
entitlements and operator roles must be inventoried using approved read-only access.
Account existence does not imply blank accounts or permission to overwrite resources.

## Execution order

```text
Catalog Worker prerequisite
  -> platform contracts and inventory
  -> local infrastructure/configuration definitions
  -> state bootstrap and recovery proof
  -> GitHub trust and credential bootstrap
  -> credential-free CI and release artifact
  -> dev delivery and qualification
  -> production plan and release approval
  -> production deployment
  -> drift/recovery drills and handover
```

Each increment starts with failing tests for its new behavior, changes the minimum
needed to pass, and ends with a reviewable handoff. Do not stack work on a failed gate.
Remote actions require separate approval identifying the account and resources.

## Work packages

### P0. Confirm readiness and platform contracts

Files: `docs/runbooks/delivery-prerequisites.md`, delivery contract fixtures under
`tests/delivery/`, and an indexed research note under `.agents/design/`.

Verify the implemented Worker satisfies the prerequisites. Inventory both accounts
without retrieving secret values into logs. Establish a resource/setting ownership
matrix and check pinned Cloudflare/GitHub provider schemas. Test support for Stream
bindings, webhook secret retrieval/rotation, Queue consumers, Vectorize metadata
indexes, Wrangler no-rebuild uploads and D1 migration bookkeeping.

Pin versions in the repo's selected tool configuration and lockfiles; use existing
tooling where suitable. Provider coverage is not assumed from documentation for
another version. Unsupported import or settings need a tested versioned adapter,
an explicit ownership change, or a blocking decision.

Acceptance: catalog readiness is recorded; every desired resource has one owner;
existing resources have a non-destructive adoption strategy. Unknown provider
contracts and account entitlements block affected work.

### P1. Define infrastructure roots and environment contracts

Files: `infra/modules/catalog/`, `infra/environments/{dev,prod}/`,
`infra/bootstrap/`, `config/environments/{dev,prod}.json`,
`scripts/delivery/`, `tests/delivery/`, relevant ignore rules.

Use OpenTofu with separate Cloudflare roots and backend credentials. Provision D1
containers, private transcript R2, Queues/DLQs, Vectorize indexes/metadata indexes,
and supported DNS using shared modules and explicit environment inputs.
Do not create a Worker script or consumer under OpenTofu if Wrangler owns it.
Do not put table contents, embeddings or media in infrastructure state.

Create typed configuration validation and a deterministic Wrangler-config renderer.
Use allowlisted resource outputs, not full `tofu output -json` dumps. Enforce
distinct dev/prod account IDs, resource ownership, compatible schema/model settings,
and absence of prod bindings in dev. Generated runtime config must be reproducible
from tracked templates and non-secret state outputs, not a second hand-edited source.
Keep IDs required at runtime out of compile-time application code.

Separate foundational resources from activation resources. Use a separate
activation root for the account's Stream webhook, so ordinary foundation apply
does not register it before the receiver exists. The activation root uses its own
state key, plan and approval record; do not use routine `-target` to force ordering.

Acceptance: offline OpenTofu validation succeeds with locked provider schemas.
Config fixtures reject cross-account IDs, absent bindings, unexpected output fields,
destructive replacements and competing ownership of any setting.

### P2. Bootstrap encrypted, lockable state with recovery

Files: `infra/bootstrap/{dev,prod}/`, backend/encryption definitions for each root,
`scripts/delivery/state-*`, `docs/runbooks/state-recovery.md`.

Bootstrap private R2 state buckets from versioned configuration with encrypted
initial local state. Archive/migrate that bootstrap state and store its recovery
keys separately. Application roots cannot delete backend resources.
Assign independent environment credentials, encryption keys, root state paths,
and private encrypted-plan storage.

Prove OpenTofu S3 conditional-write locking against R2 with the pinned versions:
contending writers, failed acquisition, owner-only release, interrupted apply and
audited stale-lock recovery. GitHub concurrency is not a substitute for backend
locking. Do not assume S3 bucket versioning or object lock.
Snapshot encrypted state before/after changes and after partial failure using
unique, non-overwriting keys. Verify lineage, serial and decryption before restore.
Limit snapshot deletion credentials and document failure modes of same-account
backups; separately recoverable keys are mandatory.

Acceptance: an authorized dev exercise proves exclusive writes and recovery from a
known snapshot. No plaintext state/plan/key reaches Git, logs or public artifacts.
If R2 locking fails, stop and amend the backend decision before application apply.
Prod bootstrap is a distinct approval, not inferred from the dev exercise.

### P3. Establish GitHub trust and secret bootstrap

Files: `infra/github/` using a pinned supported GitHub provider,
`config/delivery-policy.json`, secret-name manifests, bootstrap scripts and runbook.

Manage protected main, restricted release-tag creation/update/deletion, CODEOWNERS,
required checks, and GitHub environments as code. Resolve maintainer/team IDs and
available protection features before applying. Bootstrap required checks in an
order that does not deadlock merging the first workflow.

Separate dev mutation, prod planning, prod mutation and control-plane authority.
Require reviewer approval for sensitive prod contexts and prohibit self-review
and routine bypass. Prod planning needs separately scoped read/state access;
it must not receive apply credentials merely to show a plan.
Only trusted code can use state even when cloud access is read-only.
Ordinary application deployment cannot change its own environment protections.

Use account-scoped Cloudflare API tokens for the documented Wrangler flow; do not
assume native GitHub OIDC exchange. Give `id-token: write` only to a verified use,
such as build attestation. Define rotation, expiration and key-recovery procedures.
Document that secret existence/read-back differs from retrieving secret values.
Do not expose backend decrypt keys as global repository secrets.

Acceptance: fork/PR workflows cannot access any cloud/state credentials; dev
credentials fail cross-account authorization; prod mutation requires a reviewer.
If required protections are unavailable, block activation rather than bypass them.

### P4. Implement unprivileged CI and immutable artifacts

Files: `.github/workflows/ci.yml`, trusted build workflow,
`scripts/delivery/{check,build,manifest,verify-artifact}.*`, tests and lockfiles.

Start with `tara new ci` after inspecting the resulting template. Preserve the
Python gate, then compose Worker format/lint/types/runtime tests, migration tests,
OpenTofu offline validation, config tests, actionlint, zizmor and secret scanning.
Do not imply Tara's Python gate already covers TypeScript or infrastructure.

Use `pull_request` without secrets or state access. Repeat the gate on the exact
protected-main commit for the release build. Pin actions to full SHAs, use
`contents: read`, disable persisted checkout credentials, quote/validate event
inputs, and isolate caches between untrusted and privileged execution.

Produce one secret-free artifact with bundled modules/assets, entrypoint manifest,
migration files/checksums, source SHA, lockfile/tool hashes, IaC/config revisions,
and schema compatibility declarations. Sign/attest provenance using GitHub's
supported mechanism. Verify bundle digest and module inventory on consumption.

Wrangler's documented `deploy --dry-run --outdir` can produce the bundle; confirm
the pinned tool's no-bundle deployment path. Disable custom build hooks in deploy
config so a deployment cannot silently rebuild even when `--no-bundle` is used.
Reuse the already pinned toolchain without running arbitrary package install hooks
while production credentials are present.

Acceptance: PR execution has no cloud access; tampered modules/migrations/manifests
fail verification; dev and prod uploads preserve the artifact code digest.

### P5. Implement dev deployment and qualification

Files: `.github/workflows/deploy-dev.yml`, delivery orchestration/policy scripts,
dev integration fixtures, `docs/runbooks/deploy-dev.md`.

On a successful trusted main build, identify the exact run, commit and digest.
Under one environment-wide mutation gate, validate account identity; plan
foundations; inspect change policy; snapshot; apply the saved plan; render config;
apply additive D1 migrations; install required runtime secrets and deploy the
artifact. Use separate reviewed activation steps for cron, Queue consumers and
the Stream subscription after receiver readiness.

Resolve the webhook/secret ordering explicitly: capture a generated signing secret
privately, install it without logging, and replay/reconcile transition events.
Inspect the existing account subscription before changing it. Define how to handle
secret rotation and events delivered before installation; no early success response.

Run real synthetic webhook-to-D1, transcript-to-R2, Queue and vector-index scenarios
in dev. Record qualification only after success, binding artifact digest to the
exact code, IaC/config inputs, schema state, run and account.
Keep evidence outside mutable ad hoc branch files.

Acceptance: failed apply/migration/smoke cannot mark an artifact eligible for prod.
Duplicate webhook delivery converges; no prod data is used. Partial failures stop
the sequence and preserve state/recovery evidence.

### P6. Implement tagged production plan and approval

Files: `.github/workflows/release.yml`, release eligibility/policy scripts,
private plan storage adapter, `docs/runbooks/release.md`.

Adopt protected SemVer release tags; validate actual SemVer in code rather than
trusting an event glob. Verify tag object/commit, protected-main ancestry, trusted
build identity, artifact provenance/digest, dev qualification and IaC/config inputs.
Never select an artifact by name or "latest" alone.
Reject old delayed approvals that would replace a newer deployment unless using an
explicit rollback procedure. Never downgrade live infrastructure via an old tag.

Retain qualified artifacts and attestations in controlled GitHub artifact/release
storage; a release tag points to retained bytes, not a rebuild instruction.
Choose and document retention/recovery policy before activation. If bytes or dev
evidence expire, require rebuild and dev requalification.

Generate fresh prod foundation and activation plans from the release revision
against current state. Persist encrypted full plans privately; publish only an
allowlisted sanitized change summary. Approval records bind each plan digest,
artifact, config, migration set and state lineage/serial. Unknown activation output
cannot be waved through: changed plans require new approval.
Recheck identity, eligibility, drift and input freshness after approval.

Acceptance: mismatched digest, unqualified commit, moved tag, stale state,
untrusted provenance, expired artifact or missing reviewer rejects promotion.
Full plans and state never appear in this public repository's Actions artifacts.

### P7. Deploy prod with a complete mutation guard

Files: production delivery jobs, shared mutation controller, receipt scripts,
`docs/runbooks/deploy-prod.md`.

Serialize apply, migration, secret installation, deploy and activation as one
environment operation, including recovery workflows. Do not lock each job
independently and permit another release between them. Use a shared concurrency
group with `cancel-in-progress: false` for the entire mutation run, and backend
locks for state operations. Local operators must acquire the same operational
exclusion or suspend CI before maintenance.

GitHub concurrency is not a reliable release-order policy. Validate the current
deployment receipt and release eligibility after obtaining the gate. Document
pending-run cancellation/queue behavior for the pinned workflow syntax. Cancel
superseded non-mutating CI, never intentionally interrupt an active mutation.

Apply approved plans with snapshot recovery available, run checksummed,
backward-compatible migrations, then deploy verified artifact bytes with prod
bindings. Activate producers only when compatible consumers/secrets exist.
Run non-destructive smoke checks; persist artifact/config digests, plan identities,
Worker version IDs and migration state as a deployment receipt.

Acceptance: overlapping deploy/recovery attempts cannot interleave mutations.
Any stage failure stops further activation, records partial progress and leaves an
actionable recovery route. Prod operations require separately granted approval.

### P8. Add drift detection, recovery and operational handoff

Files: `.github/workflows/drift.yml`, approved recovery workflow/scripts,
`docs/runbooks/{drift,rollback,restore,secret-rotation}.md`, README links.

Compare live infrastructure, Worker bindings/config, subscriptions and GitHub
protections with the correct desired revision. Prod drift compares to its deployed
release, not unreleased application changes on main; trusted main supplies the
scanner. Report drift without auto-applying production.

Test fresh and incremental migrations; prevent applied-file checksum edits.
Use expand/deploy/backfill/contract, retain compatibility with queued old messages,
and explicitly gate destructive changes. Code rollback does not rewind data,
queues, vectors, state or infrastructure.

Exercise failed/partial apply, interrupted migration, stale approval, bad artifact,
webhook-secret rotation, Worker rollback, expired artifact and encrypted-state
recovery in dev. Recover state only with provider read-back/reconciliation and an
audit trail. Restoring application data also needs a write-loss assessment.
Do not implement automatic force-unlock, blind state rewinds or automatic destroy.

Acceptance: approved runbooks and repeatable dev exercises prove recovery.
Relevant gates pass, redacted evidence is retained, documentation and indexed
handover are current, and only intended files are staged. Developer commits/pushes.

## Cross-cutting failure cases

| Scenario | Required behavior |
| --- | --- |
| Wrong account or resource binding | Fail before mutation |
| R2 lock contention | No second writer; bounded failure, no force-unlock |
| Compromised PR artifact/cache | Never trusted for deployment or secret-bearing execution |
| Missing/modified dev evidence | No production eligibility |
| Cloud state changes after approval | Reject saved-plan application and replan/reapprove |
| Worker upload tries to rebuild | Reject; artifact digest remains the release contract |
| Webhook arrives before secret readiness | Reject/retry where supported; reconciliation repairs gaps |
| Apply partially succeeds | Preserve actual state, stop pipeline, require inspected recovery |
| Old release resumes after newer deployment | Reject normal promotion; explicit rollback path only |
| Prod drift scanner sees newer main | Compare prod runtime/IaC to deployed release instead |

## Authorization and completion boundaries

Publishing this plan changes only the plan document, its `.agents/plan/index.md`
entry, and an indexed handover note. Both ADRs remain Proposed until separately
accepted. No credentials are requested in chat.

Later code implementation requires a separate request and the catalog prerequisite.
Read-only account inspection, dev bootstrap/testing, GitHub protection changes,
prod bootstrap, and first production deployment each require explicit remote scope.
The existence of this plan does not grant ongoing infrastructure mutation authority.

Before production activation, the maintainer must supply reviewer identities,
domain choices, credential owners, retention/backup requirements and supported
plan entitlements through an appropriate secure process. These are execution
inputs, not values to invent in the plan.

## Sources

- [ADR-0002 references](../../docs/adr/0002-isolate-dev-and-prod-delivery.md#references)
- [Wrangler bundling](https://developers.cloudflare.com/workers/wrangler/bundling/)
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
