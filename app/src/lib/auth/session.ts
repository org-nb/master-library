import { jwtVerify, SignJWT } from 'jose'
import { UnauthorizedError } from '../errors.js'
import type { Role } from '../roles.js'

export interface SessionClaims {
	/** Verified email address (session subject). */
	sub: string
	role: Role
}

/**
 * Sign a stateless session cookie (ADR-0005).
 *
 * The cookie is a signed compact JWT; every request re-validates it and
 * re-checks the allowlist, so revocation lands with the next deploy.
 *
 * @param secret - SESSION_SECRET
 * @param claims - subject and role
 * @param ttlMs - lifetime in milliseconds
 * @param now - injectable clock (ms epoch) for tests
 * @returns signed compact token
 */
export async function signSession(
	secret: string,
	claims: SessionClaims,
	ttlMs: number,
	now: number = Date.now(),
): Promise<string> {
	const expiresAt = Math.floor((now + ttlMs) / 1000)
	return new SignJWT({ ...claims })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt(Math.floor(now / 1000))
		.setExpirationTime(expiresAt)
		.sign(new TextEncoder().encode(secret))
}

/**
 * Verify a session cookie token.
 *
 * @param secret - SESSION_SECRET
 * @param token - compact token from the cookie
 * @param now - injectable clock (ms epoch) for tests
 * @returns session claims
 * @throws UnauthorizedError when the token is invalid or expired
 */
export async function verifySession(
	secret: string,
	token: string,
): Promise<SessionClaims> {
	try {
		const { payload } = await jwtVerify(
			token,
			new TextEncoder().encode(secret),
			{
				algorithms: ['HS256'],
			},
		)
		const sub = typeof payload.sub === 'string' ? payload.sub : ''
		const role = payload.role
		if (sub === '' || (role !== 'member' && role !== 'librarian')) {
			throw new UnauthorizedError('malformed session')
		}
		return { sub, role }
	} catch (err) {
		if (err instanceof UnauthorizedError) throw err
		throw new UnauthorizedError('invalid session')
	}
}
