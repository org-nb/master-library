import type { Role } from '../roles.js'

export interface AllowlistUser {
	email: string
	role: Role
}

/**
 * Parse the per-user GitHub-secret allowlist (ADR-0005).
 *
 * Expects OAUTH_USER_COUNT and OAUTH_USER_1..N with values `email|role`.
 * Entries are stored lower-cased; matching is exact (no wildcard, no
 * domain-level grants).
 *
 * @param env - environment mapping
 * @param problems - accumulates issues (caller decides when to fail)
 * @returns allowlist users in secret order
 */
export function parseAllowlist(
	env: Record<string, string | undefined>,
	problems: string[],
): AllowlistUser[] {
	const countRaw = env.OAUTH_USER_COUNT
	const count = countRaw === undefined || countRaw === '' ? 0 : Number(countRaw)
	if (!Number.isInteger(count) || count < 0) {
		problems.push('OAUTH_USER_COUNT must be a non-negative integer')
		return []
	}
	const users: AllowlistUser[] = []
	for (let i = 1; i <= count; i += 1) {
		const raw = env[`OAUTH_USER_${i}`]
		if (
			raw === undefined ||
			!/^[^|]+@\S+\.\S+\|(member|librarian)$/.test(raw.trim())
		) {
			problems.push(`OAUTH_USER_${i} must be set to email|role`)
			continue
		}
		const sep = raw.indexOf('|')
		users.push({
			email: raw.slice(0, sep).trim().toLowerCase(),
			role: raw.slice(sep + 1) as Role,
		})
	}
	return users
}

/**
 * Resolve a login against the allowlist.
 *
 * An unverified email is rejected even when it appears in the allowlist
 * (ADR-0005: the email_verified claim must be true).
 *
 * @param users - allowlist
 * @param email - presented email
 * @param emailVerified - OIDC email_verified claim
 * @returns the matching user, or null when not authorized
 */
export function findUser(
	users: AllowlistUser[],
	email: string,
	emailVerified: boolean,
): AllowlistUser | null {
	if (!emailVerified) return null
	const lower = email.toLowerCase()
	return users.find((user) => user.email === lower) ?? null
}
