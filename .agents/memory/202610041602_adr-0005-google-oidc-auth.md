# ADR-0005: Google OIDC auth design handoff

2026-10-04, design-only session.

## What changed

New `docs/adr/0005-google-oidc-login-with-github-user-allowlist.md`
(Proposed):

- OIDC authorization code + PKCE against Google (arctic), implemented
  in the SvelteKit server; default-deny against an in-memory allowlist.
- Per-user GitHub environment secrets `OAUTH_USER_<N>` holding
  `email|role`, with `OAUTH_USER_COUNT`; materialized into the container
  env at deploy. Add/remove/role-change = secret edit + redeploy.
- Stateless signed HttpOnly session cookie (12 h cap); every request
  re-checks the allowlist, so revocation lands with the next deploy.
- No Google tokens persisted; separate dev/prod Google OAuth clients;
  login/logout/deny events go to the audit stream.

ADR-0004 updated: librarian-login placeholder replaced with the
ADR-0005 reference; rollout gains an auth slice (step 3) and renumbers
to nine steps. README updated: ADR-0005 status bullet, design-records
link, and an app-runtime-secrets note in the credentials guide.

## Trade-offs flagged in the ADR

- User management is a deployment action, not a UI action.
- GitHub secrets are write-only: membership audit = secret names +
  runbook, not a readable list.
- Login depends on Google availability; anonymous reading is
  unaffected.
- Indexed-secret scheme gets clunky past a few dozen users; revisit
  with a real IdP if the editor group grows.

## Still open

- The ADR-0004 review's finding 9 (design-doc frontmatter drift vs
  committed ADR-0003 pointer/tier model) remains tracked.
- Google Cloud OAuth client creation is an operator task at rollout
  step 1; not blocking design.

No code or deployment ran. Suggested commit message:
`docs(adr): add Google OIDC login with GitHub-provisioned user allowlist`
