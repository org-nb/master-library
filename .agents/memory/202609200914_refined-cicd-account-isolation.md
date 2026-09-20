# CI/CD account isolation refinement

**Date:** 2026-09-20

Refined ADR-0002 to state that separate Cloudflare accounts provide authorization
isolation, while prefixes in one account provide organization and limited
targeting safeguards only.

The ADR now records the operational benefits and risks of the same-account
alternative, plus minimum compensating controls and explicit risk acceptance for
any exception. The Proposed decision and implementation scope are unchanged.
