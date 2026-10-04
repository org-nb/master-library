import { json } from '@sveltejs/kit'
import { getDeps } from '$lib/deps.js'

/**
 * Liveness/readiness probe (A1): the container is healthy only when the
 * app answers and the loopback oxivault API is reachable.
 */
export async function GET() {
	const deps = await getDeps()
	try {
		await deps.notes.vaultInfo()
		return json({ status: 'ok', oxivault: 'ok' })
	} catch {
		return json({ status: 'degraded', oxivault: 'error' }, { status: 503 })
	}
}
