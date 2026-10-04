import { ForbiddenError, UnauthorizedError } from '../errors.js'
import type { Role } from '../roles.js'
import { ROLE_RANK } from '../roles.js'
import type { SessionClaims } from './session.js'
import { verifySession } from './session.js'

/**
 * Extract the session from a Cookie header value.
 *
 * Invalid or expired tokens are treated as anonymous (null), never as a
 * 500; the caller decides between redirect and 401/403.
 *
 * @param cookieHeader - raw Cookie header value
 * @param cookieName - session cookie name
 * @param secret - session signing secret
 * @returns session claims, or null for anonymous callers
 */
export async function sessionFromCookies(
	cookieHeader: string | null,
	cookieName: string,
	secret: string,
): Promise<SessionClaims | null> {
	if (cookieHeader === null || cookieHeader === '') return null
	const cookie = cookieHeader
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${cookieName}=`))
	if (cookie === undefined) return null
	const token = decodeURIComponent(cookie.slice(cookieName.length + 1))
	if (token === '') return null
	try {
		return await verifySession(secret, token)
	} catch {
		return null
	}
}

/**
 * Enforce a minimum role on a session (UI role checks; the API enforces
 * authorization as well per ADR-0004).
 *
 * @param claims - session claims (null for anonymous)
 * @param required - minimum role
 * @returns the session claims
 * @throws UnauthorizedError for anonymous callers, ForbiddenError for low roles
 */
export function requireRole(
	claims: SessionClaims | null,
	required: Role,
): SessionClaims {
	if (claims === null) throw new UnauthorizedError('login required')
	if (ROLE_RANK[claims.role] < ROLE_RANK[required]) {
		throw new ForbiddenError(`requires ${required} role`)
	}
	return claims
}
