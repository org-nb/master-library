import { sessionFromCookies } from '$lib/auth/guards.js'
import { isPublished } from '$lib/catalog/catalog.js'
import {
	type NoteFrontmatter,
	parseFrontmatter,
	slugFromPath,
} from '$lib/catalog/frontmatter.js'
import { getDeps } from '$lib/deps.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ request, url }) => {
	const deps = await getDeps()
	const claims = await sessionFromCookies(
		request.headers.get('cookie'),
		deps.cfg.session.cookie,
		deps.cfg.session.secret,
	)

	const notes = await deps.notes.listNotes('videos/')
	const items = []
	for (const note of notes) {
		const slug = slugFromPath(note.path)
		if (slug === null) continue
		let fm: NoteFrontmatter
		try {
			fm = parseFrontmatter(note.frontmatter)
		} catch {
			continue
		}
		const visible = claims !== null || isPublished(fm)
		if (!visible) continue
		const tier = url.searchParams.get('tier')
		if (tier !== null && fm.content_tier !== tier) continue
		items.push({
			slug: fm.episode_slug,
			title: fm.title,
			description: fm.description,
			content_tier: fm.content_tier,
			year: fm.year,
			place_slug: fm.place_slug,
			event_id: fm.event_id,
		})
	}
	items.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
	return { items, role: claims?.role ?? null }
}
