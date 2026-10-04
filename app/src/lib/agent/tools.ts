import { isPublished } from '../catalog/catalog.js'
import { parseFrontmatter, slugFromPath } from '../catalog/frontmatter.js'
import { AppError } from '../errors.js'
import type { OxivaultClient } from '../oxivault/client.js'
import type { Tool } from './llm.js'

export interface ReadToolDeps {
	notes: OxivaultClient
	/** Role of the caller; anonymous callers see published content only. */
	role: 'anonymous' | 'member' | 'librarian'
}

function visibleForRole(
	role: ReadToolDeps['role'],
	fm: ReturnType<typeof parseFrontmatter>,
): boolean {
	if (role === 'anonymous') return isPublished(fm)
	return true
}

/**
 * Read-only catalog tools for the agent (ADR-0004 reader tool class).
 *
 * Every tool filters results by the caller's visibility and returns a
 * JSON summary, never raw frontmatter blobs.
 *
 * @param deps - tool dependencies
 * @returns the four read tools
 */
export function createReadTools(deps: ReadToolDeps): Tool[] {
	async function loadVisible(): Promise<
		Map<string, ReturnType<typeof parseFrontmatter>>
	> {
		const notes = await deps.notes.listNotes('videos/')
		const result = new Map<string, ReturnType<typeof parseFrontmatter>>()
		for (const note of notes) {
			const slug = slugFromPath(note.path)
			if (slug === null) continue
			let fm: ReturnType<typeof parseFrontmatter>
			try {
				fm = parseFrontmatter(note.frontmatter)
			} catch {
				continue // malformed note: skip, do not poison agent context
			}
			if (visibleForRole(deps.role, fm)) result.set(slug, fm)
		}
		return result
	}

	const searchCatalog: Tool = {
		name: 'search_catalog',
		description:
			'Search published catalog items by keyword, tier, place or event.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Keyword to search in titles and descriptions',
				},
				content_tier: { type: 'string', enum: ['recording', 'edit', 'short'] },
				place_slug: { type: 'string' },
				event_id: { type: 'string' },
			},
		},
		async run(args) {
			const visible = await loadVisible()
			const query = String(args.query ?? '').toLowerCase()
			const tier = args.content_tier as string | undefined
			const place = args.place_slug as string | undefined
			const event = args.event_id as string | undefined
			const matches = [...visible.values()]
				.filter(
					(fm) =>
						query === '' ||
						`${fm.title} ${fm.description}`.toLowerCase().includes(query),
				)
				.filter((fm) => tier === undefined || fm.content_tier === tier)
				.filter((fm) => place === undefined || fm.place_slug === place)
				.filter((fm) => event === undefined || fm.event_id === event)
				.map((fm) => ({
					episode_id: fm.episode_id,
					slug: fm.episode_slug,
					title: fm.title,
					content_tier: fm.content_tier,
					year: fm.year,
					place_slug: fm.place_slug,
				}))
				.slice(0, 20)
			return JSON.stringify({ count: matches.length, items: matches })
		},
	}

	const getItem: Tool = {
		name: 'get_item',
		description: 'Get catalog metadata for one item by episode id or slug.',
		parameters: {
			type: 'object',
			properties: {
				identifier: { type: 'string', description: 'episode id or slug' },
			},
			required: ['identifier'],
		},
		async run(args) {
			const visible = await loadVisible()
			const id = String(args.identifier ?? '')
			const fm =
				visible.get(id) ??
				[...visible.values()].find(
					(f) => f.episode_id === id || f.episode_slug === id,
				)
			if (fm === undefined) throw new AppError(`no visible item ${id}`, 404)
			return JSON.stringify({
				episode_id: fm.episode_id,
				slug: fm.episode_slug,
				title: fm.title,
				description: fm.description,
				content_tier: fm.content_tier,
				year: fm.year,
				place_slug: fm.place_slug,
				event_id: fm.event_id,
				edition: fm.edition,
				duration_seconds: fm.duration_seconds ?? null,
			})
		},
	}

	const getLineage: Tool = {
		name: 'get_lineage',
		description:
			'Get the source lineage of an item (which recordings/editions it derives from).',
		parameters: {
			type: 'object',
			properties: {
				identifier: { type: 'string', description: 'episode id or slug' },
			},
			required: ['identifier'],
		},
		async run(args) {
			const visible = await loadVisible()
			const id = String(args.identifier ?? '')
			const fm =
				visible.get(id) ??
				[...visible.values()].find(
					(f) => f.episode_id === id || f.episode_slug === id,
				)
			if (fm === undefined) throw new AppError(`no visible item ${id}`, 404)
			return JSON.stringify({
				episode_id: fm.episode_id,
				content_tier: fm.content_tier,
				source_episode_ids: fm.source_episode_ids,
				source_version_ids: fm.source_version_ids,
				source_ranges: fm.source_ranges,
			})
		},
	}

	const relatedItems: Tool = {
		name: 'related_items',
		description:
			'List items related to one item (same event or direct lineage).',
		parameters: {
			type: 'object',
			properties: {
				identifier: { type: 'string', description: 'episode id or slug' },
			},
			required: ['identifier'],
		},
		async run(args) {
			const visible = await loadVisible()
			const id = String(args.identifier ?? '')
			const fm =
				visible.get(id) ??
				[...visible.values()].find(
					(f) => f.episode_id === id || f.episode_slug === id,
				)
			if (fm === undefined) throw new AppError(`no visible item ${id}`, 404)
			const related = [...visible.values()]
				.filter((other) => other.event_id === fm.event_id)
				.filter(
					(other) =>
						!(
							other.episode_id === fm.episode_id && other.edition === fm.edition
						),
				)
				.map((other) => ({
					episode_id: other.episode_id,
					slug: other.episode_slug,
					title: other.title,
					content_tier: other.content_tier,
				}))
				.slice(0, 20)
			return JSON.stringify({ count: related.length, items: related })
		},
	}

	return [searchCatalog, getItem, getLineage, relatedItems]
}
