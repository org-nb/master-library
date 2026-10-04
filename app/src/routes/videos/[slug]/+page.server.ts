import { error } from '@sveltejs/kit'
import { sessionFromCookies } from '$lib/auth/guards.js'
import {
	isMemberPlayable,
	isPublished,
	publicPlaybackUrl,
	relatedNotes,
} from '$lib/catalog/catalog.js'
import { parseFrontmatter, videoPath } from '$lib/catalog/frontmatter.js'
import { getDeps } from '$lib/deps.js'
import { assertMediaKey } from '$lib/keys.js'
import { ROLE_RANK } from '$lib/roles.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ request, params }) => {
	const deps = await getDeps()
	const claims = await sessionFromCookies(
		request.headers.get('cookie'),
		deps.cfg.session.cookie,
		deps.cfg.session.secret,
	)
	const rank = claims === null ? 0 : ROLE_RANK[claims.role]
	const slug = params.slug
	if (slug === undefined) throw error(404, 'video not found')

	const note = await deps.notes.getNote(videoPath(slug))
	const fm = parseFrontmatter(note.frontmatter)

	// Anonymous callers only see published items; missing items are 404,
	// never 403 (no information leakage).
	if (rank === 0 && !isPublished(fm)) throw error(404, 'video not found')

	let playbackUrl: string | null = publicPlaybackUrl(deps.cfg, fm)
	const privateKey = fm.private_object_key
	if (
		playbackUrl === null &&
		rank >= ROLE_RANK.member &&
		typeof privateKey === 'string' &&
		isMemberPlayable(fm)
	) {
		assertMediaKey(privateKey, deps.cfg.s3.vaultPrefix)
		playbackUrl = await deps.s3.presignGet(
			deps.cfg.s3.privateBucket,
			privateKey,
			900,
		)
	}

	const allNotes = await deps.notes.listNotes('videos/')
	const all = []
	for (const n of allNotes) {
		try {
			all.push(parseFrontmatter(n.frontmatter))
		} catch {
			// skip malformed
		}
	}
	const related = relatedNotes(all, fm)
		.filter((other) => rank > 0 || isPublished(other))
		.map((other) => ({
			slug: other.episode_slug,
			title: other.title,
			content_tier: other.content_tier,
			year: other.year,
		}))

	return {
		slug: fm.episode_slug,
		title: fm.title,
		description: fm.description,
		content_tier: fm.content_tier,
		year: fm.year,
		place_slug: fm.place_slug,
		event_id: fm.event_id,
		edition: fm.edition,
		duration_seconds: fm.duration_seconds ?? null,
		playbackUrl,
		related,
	}
}
