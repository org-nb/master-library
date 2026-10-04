import { randomBytes } from 'node:crypto'
import { type RequestHandler, redirect } from '@sveltejs/kit'
import { getDeps } from '$lib/deps.js'

const STATE_TTL_SECONDS = 300
const STATE_COOKIE = 'ml_state'
const VERIFIER_COOKIE = 'ml_cv'

/**
 * Start the Google OIDC flow (ADR-0005).
 *
 * State and PKCE verifier are held in short-lived HttpOnly cookies; the
 * callback verifies both before any token exchange.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const deps = await getDeps()
	const state = randomBytes(16).toString('hex')
	const codeVerifier = randomBytes(32).toString('hex')
	const url = await deps.oidc.startUrl(state, codeVerifier)

	cookies.set(STATE_COOKIE, state, {
		path: '/auth/google',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: STATE_TTL_SECONDS,
	})
	cookies.set(VERIFIER_COOKIE, codeVerifier, {
		path: '/auth/google',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: STATE_TTL_SECONDS,
	})
	redirect(303, url)
}
