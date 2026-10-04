import { sessionFromCookies } from '$lib/auth/guards.js'
import { isPublished } from '$lib/catalog/catalog.js'
import {
	type NoteFrontmatter,
	parseFrontmatter,
	slugFromPath,
} from '$lib/catalog/frontmatter.js'
import { getDeps } from '$lib/deps.js'
import { NotFoundError } from '$lib/errors.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ request, url }) => {
	const query = url.searchParams.get('q')?.trim() ?? ''
	if (query === '') return { query: '', items: [] }

	const deps = await getDeps()
	const claims = await sessionFromCookies(
		request.headers.get('cookie'),
		deps.cfg.session.cookie,
		deps.cfg.session.secret,
	)

	const results = await deps.notes.search(query)
	const candidates = new Set<string>(results.bodyNotes)
	for (const triple of results.triples) {
		const source = triple.source ?? triple.subject
		if (typeof source === 'string') candidates.add(source)
	}

	const items = []
	for (const path of candidates) {
		const slug = slugFromPath(path)
		if (slug === null) continue
		let fm: NoteFrontmatter
		try {
			fm = parseFrontmatter((await deps.notes.getNote(path)).frontmatter)
		} catch (err) {
			if (err instanceof NotFoundError) continue
			throw err
		}
		const visible = claims !== null || isPublished(fm)
		if (!visible) continue
		items.push({
			slug: fm.episode_slug,
			title: fm.title,
			content_tier: fm.content_tier,
			year: fm.year,
		})
	}
	items.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
	return { query, items: items.slice(0, 50) }
}
