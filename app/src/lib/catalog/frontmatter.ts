import { z } from 'zod'
import { ValidationError } from '../errors.js'

/**
 * Frontmatter contract for `videos/<slug>.md` catalog notes (ADR-0003).
 *
 * Field names match the `context.jsonld` terms exactly, so oxivault's
 * frontmatter-to-RDF derivation needs no renaming step.
 */
export const noteFrontmatter = z.object({
	// oxivault 0.2.1 rejects note writes without a class declaration.
	// All catalog notes are episodes; the default keeps writes valid.
	type: z.string().min(1).default('VideoEpisode'),
	title: z.string().min(1),
	description: z.string().default(''),
	visibility: z.enum(['private', 'public']).default('private'),
	publication_state: z
		.enum([
			'draft',
			'publishing',
			'published',
			'publish_failed',
			'unpublishing',
		])
		.default('draft'),
	content_tier: z.enum(['recording', 'edit', 'short']),
	year: z.coerce.number().int().min(1900).max(2100),
	place_iri: z.string().url(),
	place_slug: z.string(),
	event_id: z.string(),
	event_slug: z.string(),
	episode_id: z.string(),
	episode_slug: z.string(),
	edition: z.coerce.number().int().min(1).default(1),
	duration_seconds: z.coerce.number().nonnegative().optional(),
	byte_size: z.coerce.number().nonnegative().optional(),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.optional(),
	verified: z.boolean().default(false),
	private_object_key: z.string().optional(),
	public_object_key: z.string().optional(),
	pointer_key: z.string().optional(),
	source_episode_ids: z.array(z.string()).default([]),
	source_version_ids: z.array(z.string()).default([]),
	source_ranges: z
		.array(
			z.object({
				source_version_id: z.string(),
				start_seconds: z.coerce.number().nonnegative(),
				end_seconds: z.coerce.number().positive(),
			}),
		)
		.default([]),
})

export type NoteFrontmatter = z.infer<typeof noteFrontmatter>

/**
 * Parse and validate a note's frontmatter.
 *
 * @param raw - frontmatter as returned by the oxivault API
 * @returns typed frontmatter
 * @throws ValidationError listing every problem
 */
export function parseFrontmatter(raw: unknown): NoteFrontmatter {
	const parsed = noteFrontmatter.safeParse(raw)
	if (!parsed.success) {
		throw new ValidationError(
			'invalid note frontmatter',
			parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
		)
	}
	return parsed.data
}

/**
 * Canonical note path for a catalog video.
 *
 * @param slug - readability-only episode slug
 * @returns path such as `videos/bodhicitta-part-1.md`
 */
export function videoPath(slug: string): string {
	return `videos/${slug}.md`
}

/**
 * @param path - note path
 * @returns the video slug, or null when the path is not a catalog note
 */
export function slugFromPath(path: string): string | null {
	const match = /^videos\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(path)
	return match ? match[1] : null
}
