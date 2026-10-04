import type { AppConfig } from '../env/config.js'
import type { NoteFrontmatter } from './frontmatter.js'

/**
 * A catalog note is published (public playback) only when all three hold:
 * visibility public, publication_state published, and a public key.
 */
export function isPublished(fm: NoteFrontmatter): boolean {
	return (
		fm.visibility === 'public' &&
		fm.publication_state === 'published' &&
		typeof fm.public_object_key === 'string' &&
		fm.public_object_key.length > 0
	)
}

/**
 * A note can be played by members when it is verified and has a private key.
 */
export function isMemberPlayable(fm: NoteFrontmatter): boolean {
	return (
		fm.verified === true &&
		typeof fm.private_object_key === 'string' &&
		fm.private_object_key.length > 0
	)
}

/**
 * Playback URL for a published note: public media domain + object key.
 *
 * @param cfg - app config
 * @param fm - note frontmatter
 * @returns public URL, or null when not published
 */
export function publicPlaybackUrl(
	cfg: Pick<AppConfig, 'publicMediaBaseUrl'>,
	fm: NoteFrontmatter,
): string | null {
	if (!isPublished(fm)) return null
	return `${cfg.publicMediaBaseUrl}/${fm.public_object_key}`
}

/**
 * Related items: same event, or direct lineage (source or derived).
 *
 * Pure over the full parsed note set; callers apply their own visibility
 * filter before display.
 *
 * @param all - parsed frontmatter of every catalog note
 * @param fm - the focal note
 * @returns related notes, excluding the focal one
 */
export function relatedNotes(
	all: NoteFrontmatter[],
	fm: NoteFrontmatter,
): NoteFrontmatter[] {
	const related: NoteFrontmatter[] = []
	for (const other of all) {
		if (other.episode_id === fm.episode_id && other.edition === fm.edition)
			continue
		const sameEvent = other.event_id === fm.event_id
		const derivesFrom = fm.source_episode_ids.includes(other.episode_id)
		const derivedBy = other.source_episode_ids.includes(fm.episode_id)
		if (sameEvent || derivesFrom || derivedBy) related.push(other)
	}
	return related
}
