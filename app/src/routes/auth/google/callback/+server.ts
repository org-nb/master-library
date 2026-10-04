import { error } from '@sveltejs/kit'
import { findUser } from '$lib/auth/allowlist.js'
import type { OidcIdentity } from '$lib/auth/oidc.js'
import { createRateLimiter } from '$lib/auth/ratelimit.js'
import { signSession } from '$lib/auth/session.js'
import { getDeps } from '$lib/deps.js'

const loginLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 })

/**
 * Complete the Google OIDC flow (ADR-0005).
 *
 * Verifies state + PKCE from the start cookies, exchanges the code,
 * requires email_verified, matches the allowlist (default-deny), and
 * issues the session cookie.
 */
export async function GET({ request, url }) {
	const deps = await getDeps()
	const ip =
		request.headers.get('cf-connecting-ip') ??
		request.headers.get('x-forwarded-for') ??
		'local'
	if (!loginLimiter.check(ip)) throw error(429, 'too many login attempts')

	const cookies = request.headers.get('cookie') ?? ''
	const read = (name: string): string | null => {
		const match = cookies
			.split(';')
			.map((p) => p.trim())
			.find((p) => p.startsWith(`${name}=`))
		return match ? decodeURIComponent(match.slice(name.length + 1)) : null
	}
	const state = read('ml_state')
	const codeVerifier = read('ml_cv')
	const clear = [
		'ml_state=; Path=/auth/google; HttpOnly; Max-Age=0',
		'ml_cv=; Path=/auth/google; HttpOnly; Max-Age=0',
	]

	if (
		state === null ||
		codeVerifier === null ||
		url.searchParams.get('state') !== state
	) {
		throw error(400, 'invalid or expired login state')
	}
	const code = url.searchParams.get('code')
	if (code === null) throw error(400, 'missing authorization code')

	let identity: OidcIdentity
	try {
		identity = await deps.oidc.exchange(code, codeVerifier)
	} catch (err) {
		throw error(
			401,
			`login failed: ${err instanceof Error ? err.message : String(err)}`,
		)
	}

	const user = findUser(
		deps.cfg.allowlist,
		identity.email,
		identity.emailVerified,
	)
	if (user === null) {
		const headers = new Headers()
		for (const c of clear) headers.append('set-cookie', c)
		return new Response(
			'This Google account is not authorized for the Master Library.',
			{
				status: 403,
				headers,
			},
		)
	}

	const token = await signSession(
		deps.cfg.session.secret,
		{ sub: user.email, role: user.role },
		deps.cfg.session.ttlMs,
	)
	const target = user.role === 'librarian' ? '/admin/ingest' : '/'
	const headers = new Headers()
	for (const c of clear) headers.append('set-cookie', c)
	const secure = url.protocol === 'https:' ? '; Secure' : ''
	headers.append(
		'set-cookie',
		`${deps.cfg.session.cookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(deps.cfg.session.ttlMs / 1000)}${secure}`,
	)
	headers.set('location', target)
	return new Response(null, { status: 303, headers })
}
