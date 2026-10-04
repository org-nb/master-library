import { describe, expect, it } from 'vitest'
import { signSession, verifySession } from '../../src/lib/auth/session.js'
import { UnauthorizedError } from '../../src/lib/errors.js'

const secret = '01234567890123456789012345678901'

describe('session cookies', () => {
	it('round-trips claims', async () => {
		const token = await signSession(
			secret,
			{ sub: 'a@b.org', role: 'librarian' },
			3_600_000,
		)
		expect(await verifySession(secret, token)).toEqual({
			sub: 'a@b.org',
			role: 'librarian',
		})
	})

	it('rejects expired sessions', async () => {
		const token = await signSession(
			secret,
			{ sub: 'a@b.org', role: 'member' },
			3_600_000,
			Date.now() - 3_700_000,
		)
		await expect(verifySession(secret, token)).rejects.toThrowError(
			UnauthorizedError,
		)
	})

	it('rejects tampered tokens and wrong secrets', async () => {
		const token = await signSession(
			secret,
			{ sub: 'a@b.org', role: 'member' },
			3_600_000,
		)
		await expect(
			verifySession('another-secret-01234567890123456789', token),
		).rejects.toThrowError(UnauthorizedError)
		await expect(verifySession(secret, `${token}x`)).rejects.toThrowError(
			UnauthorizedError,
		)
	})

	it('rejects tokens with a malformed role claim', async () => {
		const { SignJWT } = await import('jose')
		const token = await new SignJWT({ sub: 'a@b.org', role: 'admin' })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt(Math.floor(Date.now() / 1000))
			.setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
			.sign(new TextEncoder().encode(secret))
		await expect(verifySession(secret, token)).rejects.toThrowError(
			UnauthorizedError,
		)
	})
})
