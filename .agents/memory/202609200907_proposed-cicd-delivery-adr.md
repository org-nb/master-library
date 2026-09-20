# Proposed CI/CD delivery ADR

**Date:** 2026-09-20

Added `docs/adr/0002-isolate-dev-and-prod-delivery.md` as a Proposed ADR. It
uses separate Cloudflare accounts for development and production, OpenTofu for
resource provisioning, Wrangler for Worker delivery and D1 migrations, and
GitHub Actions with release-tag promotion.

The ADR does not authorize workflows, state backends, secrets, infrastructure,
GitHub environment changes, deployments, or migrations. R2 locking compatibility,
state recovery, account bootstrap, and the delivery pipeline remain implementation
prerequisites.
