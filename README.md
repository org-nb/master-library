# Master Library

This repository is in a transition from the historical Airtable ingestion and publication worker to the catalog architecture set out in ADR-0001 and ADR-0002.

Status:
- ADR-0001: Proposed. D1-backed editorial catalog with R2 transcript storage and hybrid search.
- ADR-0002: Proposed. Separate development and production delivery accounts with infrastructure-as-code and guarded release promotion.
- The legacy `workers/ingestion` project has been retired from this branch and is treated as historical rather than current operational code.

## Configure GitHub development credentials

Use this guide when you are a maintainer setting up the repository's `development` environment. This is for deployment and infrastructure bootstrap only after the relevant account and GitHub environment have been reviewed and approved. It does not create or validate credentials in this checkout, and it does not make the app deployable by itself.

### Scope and stop gates

The `development` environment must only be used for the development Cloudflare account. It must be separate from production credentials and must not be used to run production or shared-account workloads. The repository must have GitHub environment protection rules in place before any deployment token is used. A secret alone does not prove the project is ready to deploy; it only makes the environment available to a workflow that already has the correct branch, approval, and runtime checks.

Before adding secrets, confirm:

- the development Cloudflare account and account ID are known and approved
- the repository administrator has created a `development` environment in GitHub
- the environment has the expected branch or tag restrictions and required reviewers
- the deployment workflow is still a credential-scoped GitHub Action and not a blanket repo-wide secret
- the dev account is separate from production, with no production data or production resources in scope

### Secrets and variables to use in GitHub

Set these in the repository's `dev` environment, not in the codebase or in a public workflow file. Separate names are intentional so the project can distinguish the Worker deployment boundary from the infrastructure/bootstrap boundary.

| Name | Type | Purpose | Notes |
| --- | --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Environment variable | Cloudflare dev account identifier used by Wrangler or `cf` tooling | Non-secret; keep it environment-scoped `vars` value. |
| `CLOUDFLARE_API_TOKEN` | Environment secret | Worker deployment token for the dev account | Must be scoped to the dev account and least-privilege permissions. |
| `CLOUDFLARE_INFRA_API_TOKEN` | Environment secret | Proposed token for OpenTofu or infrastructure bootstrap in the dev account | Separate from the Worker deployment token; do not assume it is required until the bootstrap root is implemented. |
| `R2_STATE_ACCESS_KEY_ID` | Environment secret | R2 access key ID for the private dev state backend | Use only for the state bucket and keep it separate from runtime tokens. |
| `R2_STATE_SECRET_ACCESS_KEY` | Environment secret | R2 secret access key for the private dev state backend | Must be kept outside logs, artifacts, and Git. |
| `TF_STATE_ENCRYPTION_KEY` or a future equivalent | Environment secret | Key material for encrypted OpenTofu state or plan files | Exact name depends on the final OpenTofu encryption config; keep distinct from deploy credentials. |

Do not treat this as a blanket list of all future Cloudflare secrets. The project must add each secret only when the matching feature is implemented and approved. The Worker deployment token is the first credential that can plausibly be used in a GitHub Actions deployment job; the state and bootstrap credentials remain prospective until the corresponding OpenTofu backend and locking steps are implemented.

### Create the environment and set values

In GitHub:

1. Go to the repository, then choose `Settings > Environments`.
2. Create an environment named `dev`.
3. Set the deployment branch or tag policy to the approved dev branch or protected main rule.
4. Add required reviewers, prevent self-review if the repo policy requires it, and disable administrator bypass unless the approval workflow explicitly allows it.
5. Add the environment variables and secrets under the `dev` environment.

Use the GitHub CLI for the same setup, for example:

```bash
gh variable set CLOUDFLARE_ACCOUNT_ID --env dev --repo org-nb/master-library

gh secret set CLOUDFLARE_API_TOKEN --env dev --repo org-nb/master-library

# Future bootstrap credentials, only after the matching implementation exists:
# gh secret set CLOUDFLARE_INFRA_API_TOKEN --env dev --repo org-nb/master-library
# gh secret set R2_STATE_ACCESS_KEY_ID --env dev --repo org-nb/master-library
# gh secret set R2_STATE_SECRET_ACCESS_KEY --env dev --repo org-nb/master-library
```

If you use `gh secret set`, it will prompt for the value interactively. Do not paste tokens into shell history or source-control files. The `gh secret list` and `gh variable list` commands can confirm that names were created, but they do not prove the credentials are valid or authorized.

### Cloudflare token boundaries

For the Worker deployment token, follow the Cloudflare guidance for a scoped account token:

1. Open the Cloudflare dashboard for the development account.
2. Create a token under the account's API tokens area.
3. Restrict the token to the development account and only the resources needed for the eventual Worker deployment. Do not add a token that has blanket access to every account in the same org.
4. Keep the token separate from any R2 state or infrastructure tokens. A deployment token is not the same as a backend state token.
5. Use the least-privilege permission set for the actual deployment path. For a workers.dev-only catalog branch, the permission scope should not include unrelated zones or production resources.

The Cloudflare `CLOUDFLARE_ACCOUNT_ID` is a non-secret account identifier. The API token is secret and must remain inside GitHub environment secrets. Do not add these values in the repository config or in a checked-in `.env` file.

### R2 state and encrypted backend credentials

The ADR-0002 design also requires an encrypted OpenTofu state backend and a separate dev-only state bucket. These are not the runtime Worker credentials. Configure them only after the bootstrap path is implemented and the state bucket, jurisdiction, and key rotation process are reviewed.

A typical separation is:

- Worker deploy credential: `CLOUDFLARE_API_TOKEN`
- Infrastructure/bootstrap credential: `CLOUDFLARE_INFRA_API_TOKEN`
- State backend access: `R2_STATE_ACCESS_KEY_ID` and `R2_STATE_SECRET_ACCESS_KEY`
- Encrypted state key material: a dedicated secret name for the chosen OpenTofu encryption provider

This separation matters because a deployment credential is not enough to read or write backend state, and a state credential is not enough to deploy a Worker. The backend must also pass its own locking and recovery checks before it is trusted for production or dev mutation.

### Workflow usage and environment rules

A GitHub Actions job can consume the dev environment only when it declares `environment: dev` and it is allowed by the environment rules. The workflow should reference `vars.CLOUDFLARE_ACCOUNT_ID` and `secrets.CLOUDFLARE_API_TOKEN` explicitly, rather than relying on repository-level defaults. Keep untrusted pull request jobs credential-free. Only trusted jobs on protected branches or approved workflows should receive dev environment secrets.

A deployment workflow should not expand the scope of a secret accidentally. Do not expose the token to logs, artifacts, or shell command output. Never use `echo` on a secret. Keep the token in the environment secret store and bind it to the specific GitHub Action step that uses it.

### Recovery and rotation

- Rotate credentials if the token has been exposed, a user leaves the project, or the dev account changes.
- Keep encrypted state keys and recovery material outside the repository and out of chat, logs, and build artifacts.
- Keep backup and recovery procedures documented in the operational runbooks; do not store the only backup in the same secret store as the live key.
- Do not overwrite the only decryption or state key without a tested restore path.

### References

- [Cloudflare GitHub Actions deployment guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare API token creation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
- [GitHub environments documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [OpenTofu state encryption](https://opentofu.org/docs/language/state/encryption/)
- [OpenTofu S3 remote state backend](https://opentofu.org/docs/language/settings/backends/s3/)
- [ADR-0002: Isolate development and production delivery](docs/adr/0002-isolate-dev-and-prod-delivery.md)

## Architecture and design records

- [ADR-0001: Use D1 for the video catalog](docs/adr/0001-use-d1-for-video-catalog.md)
- [ADR-0002: Isolate development and production delivery](docs/adr/0002-isolate-dev-and-prod-delivery.md)
- [Design index](.agents/design/index.md)
- [Plan index](.agents/plan/index.md)
- [Review index](.agents/review/index.md)
- [Annotation process sequence](docs/annotation-process-sequence.mermaid)
- [DPR process diagram](docs/dpr_process_complete.mermaid)

## Implementation boundary

The repository is currently split by stack layer.

- `catalog/design` holds the design and retirement boundary for the historical Worker and the new catalog direction.
- `catalog/implementation` is reserved for the ADR-0001 local implementation after the design commit is reviewed and committed.

No deployment, provisioning, or live platform changes are part of this branch state.

## Historical records

The original Airtable-era design and implementation notes remain in the project history for reference:

- [.agents/design/2026-06-07-airtable-control-plane-design.md](.agents/design/2026-06-07-airtable-control-plane-design.md)
- [.agents/design/2026-06-07-ingestion-publication-pipeline-design.md](.agents/design/2026-06-07-ingestion-publication-pipeline-design.md)
- [.agents/plan/2026-06-07-airtable-control-plane.md](.agents/plan/2026-06-07-airtable-control-plane.md)
- [.agents/plan/2026-06-07-ingestion-publication-pipeline.md](.agents/plan/2026-06-07-ingestion-publication-pipeline.md)
- [.agents/review/20260614.md](.agents/review/20260614.md)

## License

This repository is licensed under the project LICENSE file.
