# Multi-backend video design handoff

Design-only scope confirmed. Updated ADR-0001 for logical videos, content
versions, R2/Stream/S3 assets and locations, provider-specific grants,
synchronization and an expand/backfill/contract migration. Updated the cost
comparison, optional AWS isolation in ADR-0002, README and Stream-first
epic/story. Historical Airtable designs remain unchanged.

Official pricing supports the sample media subtotals: Stream $90, R2 plus
Worker $7.18, direct S3 $70.16, S3 plus unused CloudFront allowances $3.72.
These exclude encoding, common catalog services and operational labor.

Reviewed identity, timeline, access, long-session renewal, cache and migration
boundaries. Repository `tara check --no-fail-fast` passed. Local Markdown links
and cost calculations were checked; currency uses decimal half-up rounding.
No runtime behavior changed, so new behavior tests and live integration/release
do not apply. No migration, deployment, provisioning or account access occurred.

Implementation remains outstanding: the current SQL/Worker still requires
`stream_uid`. Start with migration/identity contracts and Stream ingestion;
qualify R2 and S3/CloudFront separately using ADR-0001's acceptance cases.
The proposed grant lifetimes imply bounded, not immediate, revocation.

Documentation is staged for developer review; no commit or push.
Suggested commit message: `docs: design versioned multi-backend video delivery`
