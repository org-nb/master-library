# Multi-backend video design update

Scope confirmed: design and documentation only. No Worker, migration,
infrastructure or live-account changes.

1. Compare the current Stream-only ADR/scaffold with the supplied R2 comparison.
2. Verify Cloudflare/AWS pricing and media capabilities using official sources.
3. Update ADR-0001 with logical video, edition and backend-copy identities,
   provider locators, playback/access contracts and staged schema migration.
4. Align the cost comparison, ADR-0002 isolation boundary, README and
   Stream-first epic/story. Preserve historical Airtable records.
5. Review links, calculations and consistency; stage documentation for review.

Key cases: equivalent copies versus edited timelines; non-Stream-only video;
idempotent registration; partial uploads/inventories; private cached segments;
two-hour playback and token renewal; backfill without editorial data loss.

Runtime TDD, application implementation and deployment do not apply to this
documentation increment. The ADR records acceptance cases for implementation.
