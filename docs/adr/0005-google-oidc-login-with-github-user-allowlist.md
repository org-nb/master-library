# ADR-0005: Google OIDC login with a GitHub-provisioned user allowlist

- **Status:** Proposed
- **Date:** 2026-10-04
- **Authors:** Daniel Kapitan
- **Depends on:** [ADR-0004](0004-design-sveltekit-frontend-for-catalog-and-agentic-workflows.md)
- **Amends:** ADR-0004's "operator-managed credentials" placeholder for librarian login

## Context and Problem Statement

ADR-0004 makes readers anonymous for published content but requires
real login for librarian workflows (metadata editing, lineage,
publication, write-capable agent tools). It deferred the identity
decision. The requirement is now explicit:

- Users log in with **Google** (OAuth2 / OpenID Connect).
- A login is only accepted if the Google identity appears on a
  **per-user allowlist provisioned as GitHub secrets** — one secret per
  user — following the same GitHub-environment discipline as the
  deployment credentials in ADR-0002.

How should the SvelteKit server authenticate users against Google and
authorize them from a deploy-time user list, without running an
identity provider or a user database?

## Decision Drivers

- Librarians already have Google accounts; no new passwords to issue,
  reset or store.
- No user database, no identity-provider service to operate; the app
  stays one stateless container (ADR-0004).
- User provisioning and revocation must go through reviewed,
  least-privilege GitHub environments, consistent with ADR-0002.
- Roles (librarian now; member/private-content viewer later) must be
  assignable per user.
- No Google access tokens or user data persisted; only a session cookie.
- Default-deny: an unknown Google identity gets nothing.

## Considered Options

1. **Google OIDC (authorization code + PKCE) with a per-user allowlist
   delivered as GitHub environment secrets.**
2. **Self-managed username/password accounts.** Full control, but the
   app becomes a credential store with reset flows, lockout policies
   and hashing concerns. No one wants to operate that for a handful of
   librarians.
3. **A dedicated identity provider** (Keycloak, Auth0, Cloudflare
   Access). Solves problems this catalog does not have; adds a service
   and a trust hop for a user population of a few people.
4. **Allowlist as a vault note** instead of GitHub secrets. Readable
   and versioned, but the requirement is GitHub-secret provisioning;
   also mixes access-control configuration into the data it protects.

## Decision Outcome

Chosen option: **1**.

The SvelteKit server implements the **OIDC authorization code flow with
PKCE** against Google. After the code exchange, the server verifies the
ID token, extracts the verified email address, and checks it against an
in-memory allowlist that was materialized at deploy time from per-user
GitHub environment secrets. Access is **default-deny**; each allowlist
entry also carries the user's role.

### Flow

1. Browser requests a protected surface; the server redirects to
   `/auth/google/start`.
2. The server generates `state` and a PKCE `code_verifier`, stores them
   in a short-lived HttpOnly cookie, and redirects to Google's
   authorization endpoint with scopes `openid email profile`.
3. Google redirects back to `/auth/google/callback` with an
   authorization code.
4. The server exchanges the code (with the verifier), verifies the ID
   token (issuer, audience, nonce), and requires the `email_verified`
   claim to be `true` before reading the email. An unverified email
   never matches the allowlist.
5. The server matches the email against the allowlist. On a hit, it
   issues the app session; on a miss, it renders a "not authorized"
   page and creates no session.
6. The session is a **signed, stateless HttpOnly cookie**
   (`Secure`, `SameSite=Lax`) holding subject email, role and expiry.
   No server-side session store; logout clears the cookie.

### Session validation and revocation

Every request re-validates the cookie signature and expiry **and**
re-checks that the session's email is still on the in-memory allowlist.
Because the allowlist comes from the container environment, revoking a
user (removing their GitHub secret and redeploying) takes effect
immediately after the next deployment, even for sessions issued before
the change. This trades instant revocation for deploy-time revocation,
which is acceptable for a small trusted editor group; a session
lifetime cap (recommend 12 hours, forcing re-login) bounds the window
regardless.

### User provisioning model

Per-user GitHub environment secrets, one per user, in the same `dev` /
`prod` environments used for deployment (ADR-0002):

| Secret | Example value | Meaning |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | (from Google Cloud Console) | OAuth client for this environment |
| `GOOGLE_CLIENT_SECRET` | (from Google Cloud Console) | Client secret |
| `OAUTH_USER_COUNT` | `3` | Number of allowlist entries |
| `OAUTH_USER_1` | `alice@example.org\|librarian` | Email and role of user 1 |
| `OAUTH_USER_2` | `bob@example.org\|librarian` | Email and role of user 2 |
| `OAUTH_USER_3` | `carol@example.org\|member` | Email and role of user 3 |
| `SESSION_SECRET` | (random 32+ bytes) | Cookie signing key |

Rules:

- Secret values are `email|role`; the pipe separates the verified
  Google email from the role (`librarian` today; `member` reserved for
  future private-content access).
- The deploy workflow reads `OAUTH_USER_COUNT` and `OAUTH_USER_1..N`
  and materializes them into the container environment; the app builds
  its in-memory allowlist at boot and fails closed if the count and
  entries are inconsistent.
- **Adding a user**: set the next `OAUTH_USER_<N>` secret, bump
  `OAUTH_USER_COUNT`, redeploy.
- **Removing a user**: clear the secret, renumber the list, decrement
  the count, redeploy. Existing sessions for the removed user die with
  the next deployment (or their 12-hour expiry at worst).
- Roles change by editing the user's secret value and redeploying.
- Separate Google Cloud OAuth clients for dev and prod, each with its
  own registered redirect URI (`http://localhost` for dev; the
  production HTTPS origin for prod). Dev secrets never grant prod
  access and vice versa.
- GitHub secrets are write-only: the accessible audit trail for "who
  can log in" is the secret names plus the provisioning runbook. Keep
  the runbook (who provisioned whom, when) in the operational
  documentation; do not duplicate email lists into the repository.

### Implementation notes

- Use [arctic](https://arcticjs.dev) for the OIDC/PKCE dance and cookie
  handling primitives; keep the dependency surface as small as the rest
  of ADR-0004.
- No Google refresh or access tokens are stored anywhere; the app needs
  no Google API access, only the identity assertion.
- Rate-limit `/auth/google/*` endpoints alongside the agent-panel
  limits.
- Log login, logout and deny events (email, role, timestamp, IP) in the
  same audit stream as agent-assisted mutations.
- The loopback oxivault service token (ADR-0004) is unchanged; user
  identity never reaches oxivault.

## Consequences

- Good: no passwords, no user database, no identity-provider service;
  the auth surface is one redirect flow plus a cookie check.
- Good: provisioning and revocation ride the existing GitHub
  environment review/approval discipline; least-privilege per
  environment.
- Good: default-deny with per-user roles; session validation re-checks
  the allowlist, so stale sessions cannot outlive a revocation beyond
  one deployment.
- Bad: allowlist changes require a redeploy (or a secret-sync
  workflow); user management is a deployment action, not a UI action.
- Bad: GitHub secrets are write-only, so membership audits depend on
  secret names plus runbook discipline, not a readable list.
- Bad: Google becomes an availability dependency for login (not for
  reading published content, which stays anonymous).
- Bad: the per-user indexed-secret scheme is clunky beyond a few dozen
  users; if the editor group grows substantially or self-service
  signup is ever wanted, revisit with a real IdP or an allowlist store.

## Rollout

1. Create the dev Google Cloud OAuth client (localhost redirect URI);
   set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`,
   `OAUTH_USER_COUNT`, `OAUTH_USER_1` in the `dev` GitHub environment.
2. Implement the auth routes, cookie sessions and allowlist check in
   the SvelteKit server; protect the librarian surfaces and the
   librarian-mode agent tools behind them.
3. Exercise the deny path (unlisted Google identity) and the revocation
   path (remove user, redeploy, confirm session death).
4. Repeat client and secret setup for `prod` when the production
   deployment slice happens (ADR-0002 promotion flow).

## References

- [ADR-0004: SvelteKit front-end and agentic workflows](0004-design-sveltekit-frontend-for-catalog-and-agentic-workflows.md)
- [ADR-0002: Isolate dev and prod delivery](0002-isolate-dev-and-prod-delivery.md)
- [Google Identity Platform: OpenID Connect](https://developers.google.com/identity/openid-connect)
- [RFC 6749: OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [GitHub: Environment secrets](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Arctic](https://arcticjs.dev)
