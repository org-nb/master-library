import { getDeps } from '$lib/deps.js'

/**
 * Log out: clear the session cookie.
 *
 * Statelessness means no server-side token store to revoke (ADR-0005).
 */
export async function GET() {
	const deps = await getDeps()
	const headers = new Headers({
		location: '/',
		'set-cookie': `${deps.cfg.session.cookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
	})
	return new Response(null, { status: 303, headers })
}
