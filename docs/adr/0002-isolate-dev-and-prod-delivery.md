# ADR-0002: Isolate development and production delivery

- **Status:** Proposed
- **Date:** 2026-09-20
- **Authors:** Daniel Kapitan, GitHub Copilot

## Context and Problem Statement

The proposed video catalog in [ADR-0001](0001-use-d1-for-video-catalog.md) will
use Workers, D1, R2, Queues, Vectorize, Workers AI, Stream and D1 migrations.
It needs a delivery system that keeps development experimentation isolated from
production data and traffic, while making infrastructure, configuration and
deployment behavior reviewable and reproducible.

How should the project validate changes, promote a tested release across two
Cloudflare accounts, and recover safely without treating dashboard configuration,
secrets, or infrastructure state as untracked manual work?

## Decision Drivers

- Isolate development credentials, resources, data and failures from production.
- Promote the same tested Worker code to production without assuming resource IDs
  or Worker version IDs can cross accounts.
- Keep desired infrastructure, non-secret configuration, migrations, workflows
  and operational procedures under version control.
- Limit mutation credentials and production approval to the smallest necessary
  trusted contexts.
- Make state, plan, database and Worker rollback limits explicit.
- Detect and reconcile drift rather than normalizing dashboard-only changes.

## Considered Options

1. **Separate Cloudflare accounts with OpenTofu, Wrangler and GitHub Actions.**
   OpenTofu provisions account resources, Wrangler deploys Worker code and owns
   its runtime configuration, and GitHub Actions validates and promotes releases.
2. **One Cloudflare account with environment prefixes or Wrangler environments.**
   Resource names and bindings distinguish development and production, while
   credentials, quotas and account administration remain shared.
3. **Dashboard or Wrangler-only provisioning.** Workers and resources are created
   through the Cloudflare dashboard or deployment commands without a complete
   desired-state definition.
4. **Provider-only Worker deployment.** OpenTofu owns both resource provisioning
   and Worker deployment configuration.
5. **Cloudflare Workers Builds as the primary orchestrator.** Cloudflare performs
   builds and deployment instead of GitHub Actions.

## Decision Outcome

Chosen option: **separate Cloudflare development and production accounts, with
OpenTofu for infrastructure, Wrangler for Worker delivery and migrations, and
GitHub Actions for CI/CD**.

Development and production accounts each own their Worker, D1 database, private
R2 bucket, Queues and dead-letter Queue, Vectorize index, Stream library, webhook
signing secret, credentials and remote state backend. Development contains only
synthetic or explicitly sanitized fixtures. Account IDs are checked against an
environment allowlist before every mutating command.

Separate accounts are selected for **authorization isolation**, not merely resource
namespacing. A `dev-` or `prod-` prefix can prevent confusion, but it cannot stop
a credential with account-level authority, a provider-targeting mistake, or a CI
defect from selecting a production resource in the same account. With separate
accounts and correctly scoped credentials, the same defect becomes an authorization
failure rather than a production mutation.

OpenTofu owns durable account resources. Wrangler owns Worker code, bindings,
variables, compatibility settings, observability, routes, schedules, Queue
producer/consumer configuration and D1 migration execution. The project must give
every resource and setting one owner; neither tool may overwrite the other's
configuration. GitHub repository protections, environments, variables, rulesets
and required checks are also managed as code using supported GitHub provider or
API tooling. Versioned reconciliation adapters must cover material provider gaps.

The release path is:

```text
pull request
  -> unprivileged validation
  -> protected main
  -> trusted build and immutable artifact
  -> development OpenTofu plan/apply, migration, Worker deploy, smoke tests
  -> protected release tag selecting the verified artifact
  -> production-specific plan and required approval
  -> production apply, migration, same artifact deployment, smoke tests
```

Merging to `main` deploys and verifies development. A protected release tag must
identify a protected-main commit and an artifact digest already verified in
development. The production release rebuilds neither arbitrary source nor a
replacement artifact. It deploys the same code artifact with production-only
bindings and configuration. It creates a production-specific OpenTofu plan;
development state, resource IDs, Worker version IDs and infrastructure plans are
never promoted across accounts.

### Consequences

- Good: a compromised or faulty development deployment cannot directly mutate
  production resources or access production application data.
- Good: code, migrations, infrastructure definitions, workflow behavior and
  non-secret environment configuration are reviewable and reproducible.
- Good: release provenance connects a production deployment to a protected-main
  commit, tested artifact, infrastructure revision, migration set and approver.
- Good: separate tools reduce coupling between frequent code releases and provider
  resource coverage, provided the ownership boundary remains enforced.
- Good: drift checks and recovery runbooks expose manual changes and state damage.
- Bad: two accounts duplicate resources, billing setup, secrets, state backends
  and operational monitoring.
- Bad: account bootstrap, OpenTofu state recovery, GitHub environment protection
  and release artifact retention add operational work before application delivery.
- Bad: production approval cannot make an unsafe migration reversible. Database,
  R2, Queue and Vectorize state must be treated as independent from Worker code.
- Bad: Cloudflare and provider capabilities can differ from the desired ownership
  matrix. Unsupported pieces require a tested reconciliation adapter or a revised
  decision, not a dashboard exception.

### Same-Account Alternative

One account with prefixes is lower-cost to bootstrap and operate: it avoids a
second billing setup, duplicate secrets, duplicated resource provisioning and
cross-account observability work. It can be suitable for non-sensitive prototypes,
low-risk internal tools, or a temporary development stage where separate accounts
are not yet operationally possible.

It is not equivalent isolation. Both environments remain exposed to shared
account-level policy failures, suspension, quotas, billing, administration and any
credential with authority broad enough to address both sets of resources. Separate
state prefixes and environment-specific names reduce accidental targeting but do
not create an account boundary.

Any exception to this decision requires explicit risk acceptance and, at minimum,
separate narrowly scoped credentials, independent state keys and encryption keys,
hard account and resource-name allowlists in every mutating command, a prohibition
on production-data copies into development, and drift checks that verify every
production binding. These controls reduce risk but do not replace separate-account
authorization isolation.

## Architecture

### Repository layout

The following layout is prospective. This ADR does not create it.

```text
infra/
  bootstrap/             # state backend bootstrap roots
  modules/               # shared OpenTofu modules
  environments/
    dev/
    prod/
config/environments/     # non-secret, rendered runtime inputs
workers/catalog/
  wrangler.jsonc
  migrations/
.github/workflows/
scripts/delivery/
```

Pin OpenTofu, Cloudflare provider, Wrangler, action commits and application
dependencies. Non-secret resource IDs flow from allowlisted OpenTofu outputs into
a deterministic environment-config renderer. Do not hand-copy dashboard IDs or
export complete state into configuration files.

### Ownership matrix

| Owner | Version-controlled responsibility |
| --- | --- |
| OpenTofu Cloudflare roots | D1 containers, R2 buckets, Queue and dead-letter Queue resources, Vectorize indexes, supported DNS, and Stream webhook subscription |
| Wrangler | Worker code, bindings, vars, compatibility settings, observability, routes, schedules, Queue producer/consumer settings and D1 migrations |
| Migration runner | Ordered, append-only D1 SQL migrations and applied-version checks |
| GitHub control-plane bootstrap | Repository rulesets, GitHub environments, protection rules, variables, required checks and tag restrictions |
| Secret provisioning scripts | Secret names, contracts, redacted injection and read-back from protected secret stores |
| Reconciliation adapters | Idempotent versioned scripts plus drift checks for provider gaps |

The current Cloudflare provider exposes a Stream webhook signing secret as a
sensitive computed value. Sensitive state and plans must not be printed, uploaded
as public artifacts or exposed in GitHub logs.

### Credentials and environments

Each GitHub environment has separate account IDs and narrowly scoped Cloudflare
credentials. Production credentials are available only to protected production
jobs after approval. Development credentials cannot access production accounts.
Read-only planning credentials and state access are still sensitive because state
can contain secrets; trusted plan jobs run only from protected code.

Every workflow starts with `permissions: contents: read`, grants only job-specific
permissions, disables checkout credential persistence, sets a timeout and uses
concurrency controls. Third-party actions are pinned by full commit SHA. Untrusted
pull requests run under `pull_request` without cloud, state or production secrets;
they never run PR code through `pull_request_target` or a privileged workflow
handoff. Shell commands receive untrusted refs through quoted environment variables,
not expression interpolation.

GitHub environments restrict deployment branches and tags, require reviewers, and
prevent self-approval or routine administrator bypass where supported. These
controls must be verified during bootstrap. A release job rechecks artifact,
commit and infrastructure-plan identity after approval before it receives mutation
credentials.

### OpenTofu state and bootstrap

Each account has a separate protected R2 state bucket. A versioned bootstrap root
creates each backend before dependent application roots run. Application roots must
not destroy their own state bucket.

OpenTofu state and plan encryption are required. Decryption keys stay outside Git
and have separately tested recovery. The R2 backend configuration uses conditional
locking if the pinned OpenTofu version and R2 compatibility test demonstrate
`use_lockfile` correctness. R2 bucket versioning and object lock are not assumed:
before and after every state mutation, delivery stores encrypted snapshots at
unique keys and validates recoverability. Backend locks apply to every client;
per-environment workflow serialization prevents concurrent CI mutations. Neither
mechanism alone protects against all operators or execution paths.

If locking cannot be demonstrated, implementation stops and this ADR must be
amended before infrastructure is applied. Force-unlock is an audited manual
recovery procedure, never an automated retry. State encryption does not prevent
replay or recover a lost key, so snapshot lineage, serial checks and key recovery
are part of the disaster-recovery procedure.

## Delivery and Operations

### Pull request validation

Run an unprivileged `pull_request` gate with locked dependencies and no cloud or
state credentials. It runs formatting, linting, type checks, security checks,
Workers runtime tests, migration tests, configuration validation, OpenTofu format
and offline validation. The implementation must connect `tara check` to the actual
TypeScript, Python and IaC checks; the repository's present Python-only baseline
does not provide these checks automatically.

### Trusted development deployment

On the exact merge commit, repeat required gates and build one digest-addressed,
secret-free artifact containing Worker modules/assets, migrations and a release
manifest. Record source SHA, lockfile and tool hashes, configuration-template
revision and IaC revision. Generate provenance attestations where supported.

Serialize development mutation. Check the expected account ID, review the
development plan, and stop on unexpected deletion or replacement. Apply the exact
saved development plan; render configuration; run compatible schema expansion;
deploy the retained artifact without rebuilding; activate consumers, schedules and
the Stream webhook only after the Worker and secrets exist; then run synthetic-data
integration and smoke tests. Mark the artifact development-verified only after all
steps succeed.

### Production promotion

A protected release tag selects a development-verified artifact digest. Reject an
untrusted or moved tag, an artifact not built from protected `main`, missing
provenance, an unavailable artifact, or a changed IaC/configuration revision.
Rebuilds require a new development qualification; production never silently
rebuilds from tag source alone.

Generate a fresh production plan against current production state in a trusted
read-only context. Keep the complete encrypted plan private and expose only an
allowlisted, sanitized summary. Required approval binds the commit, artifact digest,
plan digest, configuration revision and migration set. Changed state, expired plans
or changed input requires a new plan and approval.

Under production serialization, snapshot/recovery-check state and database, apply
the approved plan, render production configuration, run backward-compatible
migrations, deploy the same Worker artifact, run bounded non-destructive smoke
checks, and record deployed Worker and migration identifiers. Development and
production Worker version IDs are distinct.

### Drift, migration, rollback and recovery

Run scheduled drift checks from trusted protected-main code. Report infrastructure,
Worker configuration, webhook and GitHub protection differences without
automatically applying production changes. Reconcile emergency changes into code
before regular deployment resumes.

D1 migrations are immutable and ordered. Test fresh creation and upgrade from the
deployed schema. Use expand, deploy, backfill, contract across releases; queue
consumers and retained Worker versions must remain compatible during the rollback
window. Block ordinary destructive database or data-bearing resource changes.
Require an explicit maintenance procedure, recovery evidence and approval for them.

Worker rollback selects a compatible known-good production Worker version or
retained code artifact. It does not roll back D1, R2, Queues, Vectorize,
OpenTofu state or infrastructure. Roll back schema by a forward corrective migration
where possible. A state/database restore is an audited recovery that accounts for
writes since the snapshot and rechecks provider state before returning to delivery.
Do not use `tofu destroy`, blind state rewinds or an old release's infrastructure
definition as a general rollback command.

## Rollout

1. Verify account ownership, billing, initial secret/key entry and supported
   GitHub protection rules as explicit bootstrap procedures.
2. Prove the pinned OpenTofu S3 backend against R2 for initialization, locking,
   encrypted read/write, snapshot recovery and failure handling before application
   resources are created.
3. Implement versioned bootstrap and environment roots, then establish the
   GitHub control plane and protected secret contracts.
4. Implement unprivileged CI, deterministic builds and development delivery.
5. Implement protected tag eligibility, production plan approval and production
   deployment with non-destructive smoke tests.
6. Exercise failed apply, migration recovery, Worker rollback, state restore and
   drift-reporting drills before production use.

## References

- [Cloudflare Terraform provider](https://developers.cloudflare.com/terraform/)
- [Cloudflare Workers with GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [OpenTofu S3 backend](https://opentofu.org/docs/language/settings/backends/s3/)
- [OpenTofu state encryption](https://opentofu.org/docs/language/state/encryption/)
- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [GitHub deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Cloudflare provider Stream webhook resource](https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/stream_webhook.md)
- [Cloudflare provider Queue consumer resource](https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/queue_consumer.md)
