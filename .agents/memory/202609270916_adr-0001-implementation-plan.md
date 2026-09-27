# ADR-0001 implementation planning handoff

Published a proposed dependency-ordered plan for the revised ADR-0001 and
marked the 2026-09-20 Stream-only plan superseded. The new plan covers the
existing scaffold's gaps, expand/backfill/contract migration, editorial
ownership and durable jobs, Stream ingestion/playback, edition-aware search,
R2 packaging/delivery and S3/CloudFront delivery.

Local readiness and authorized live qualification are separate per-provider
gates. Stream-first delivery is a bounded increment, not completion of all
three backends. Non-Stream ingestion remains gated until the mandatory legacy
UID is removed. Production requires separate ADR-0002 approval.

Open implementation inputs include trusted identity, grant revocation policy
acceptance, encoder/player profile, provider pagination contracts, domains,
search model/languages, migration write control and measurable quality/cost
targets. These are explicit blockers rather than silent defaults.

This turn changed only planning/discovery/handoff documents. Existing staged
design changes were preserved. No application implementation, migrations,
tests or deployment were run for this documentation-only increment.

Suggested commit message:
`docs: plan ADR-0001 multi-backend catalog implementation`
