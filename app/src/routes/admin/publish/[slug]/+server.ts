import { error, json } from '@sveltejs/kit'
import { requireRole, sessionFromCookies } from '$lib/auth/guards.js'
import { getDeps } from '$lib/deps.js'
import { AppError } from '$lib/errors.js'
import { publishVideo, unpublishVideo } from '$lib/publish/pointer.js'
import type { RequestHandler } from './$types'

function buildPublishDeps(deps: Awaited<ReturnType<typeof getDeps>>) {
	return {
		notes: deps.notes,
		s3: deps.s3,
		privateBucket: deps.cfg.s3.privateBucket,
		publicBucket: deps.cfg.s3.publicBucket,
		publicBaseUrl: deps.cfg.publicMediaBaseUrl,
	}
}

/**
 * Publish/unpublish endpoint (librarian).
 *
 * Body: `{ "op": "publish" | "unpublish" }`. The pointer state machine in
 * ADR-0003 runs here; unpublish is editorial — the media cache purge is a
 * separate operational step.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const deps = await getDeps()
	const claims = await sessionFromCookies(
		request.headers.get('cookie'),
		deps.cfg.session.cookie,
		deps.cfg.session.secret,
	)
	try {
		requireRole(claims, 'librarian')
	} catch (err) {
		if (err instanceof AppError) throw error(err.status, err.message)
		throw err
	}

	const body = (await request.json().catch(() => null)) as {
		op?: string
	} | null
	if (body?.op !== 'publish' && body?.op !== 'unpublish') {
		throw error(400, 'op must be publish or unpublish')
	}

	const publishDeps = buildPublishDeps(deps)
	try {
		if (body.op === 'publish') {
			const pointer = await publishVideo(publishDeps, params.slug)
			return json({ ok: true, pointer })
		}
		await unpublishVideo(publishDeps, params.slug)
		return json({ ok: true })
	} catch (err) {
		if (err instanceof AppError) throw error(err.status, err.message)
		throw err
	}
}
