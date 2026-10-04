import { ValidationError } from './errors.js'

/** Content tiers per ADR-0003 (recording, edit, short). */
export type ContentTier = 'recording' | 'edit' | 'short'

export const TIER_DIR: Record<ContentTier, string> = {
	recording: 'recordings',
	edit: 'edits',
	short: 'shorts',
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/

/** Metadata fields that deterministically determine a canonical key. */
export interface KeyMeta {
	year: number
	placeSlug: string
	contentTier: ContentTier
	eventId: string
	eventSlug: string
	episodeId: string
	episodeSlug: string
	edition: number
}

/**
 * Strip a display leading slash from a key.
 *
 * ADR-0003: real S3/R2 keys contain no leading slash; the key templates
 * in the ADR use one for display only.
 *
 * @param key - key, possibly with a leading slash
 * @returns normalized key
 * @throws ValidationError for empty keys
 */
export function normalizeKey(key: string): string {
	const value = key.startsWith('/') ? key.slice(1) : key
	if (value === '') throw new ValidationError('object key must not be empty')
	return value
}

/**
 * Validate the trusted metadata fields used to build a canonical key.
 *
 * @param meta - key metadata
 * @throws ValidationError listing every problem
 */
function validateKeyMeta(meta: KeyMeta): void {
	const issues: string[] = []
	if (!Number.isInteger(meta.year) || meta.year < 1900 || meta.year > 2100) {
		issues.push('year must be an integer between 1900 and 2100')
	}
	if (!SLUG_RE.test(meta.placeSlug)) issues.push('placeSlug must be kebab-case')
	if (!SLUG_RE.test(meta.eventSlug)) issues.push('eventSlug must be kebab-case')
	if (!SLUG_RE.test(meta.episodeSlug))
		issues.push('episodeSlug must be kebab-case')
	if (!ID_RE.test(meta.eventId))
		issues.push('eventId must match [a-z0-9][a-z0-9_-]*')
	if (!ID_RE.test(meta.episodeId))
		issues.push('episodeId must match [a-z0-9][a-z0-9_-]*')
	if (!TIER_DIR[meta.contentTier])
		issues.push('contentTier must be recording, edit or short')
	if (!Number.isInteger(meta.edition) || meta.edition < 1) {
		issues.push('edition must be a positive integer')
	}
	if (issues.length > 0)
		throw new ValidationError('invalid key metadata', issues)
}

function keyStem(meta: KeyMeta): string {
	return `${meta.year}/${meta.placeSlug}/${TIER_DIR[meta.contentTier]}/${meta.eventId}--${meta.eventSlug}/${meta.episodeId}--${meta.episodeSlug}/v${meta.edition}`
}

/**
 * Build the canonical playback object key for a version.
 *
 * @param meta - trusted key metadata
 * @returns key such as `2026/bodhgaya/recordings/evt--slug/ep--slug/v1/playback.mp4`
 */
export function buildPlaybackKey(meta: KeyMeta): string {
	validateKeyMeta(meta)
	return `${keyStem(meta)}/playback.mp4`
}

/**
 * Build the canonical pointer object key (private bucket).
 *
 * @param meta - trusted key metadata
 * @returns key ending in `/published.pointer.json`
 */
export function buildPointerKey(meta: KeyMeta): string {
	validateKeyMeta(meta)
	return `${keyStem(meta)}/published.pointer.json`
}

/**
 * Version identifier for lineage references: `<episode_id>:v<edition>`.
 *
 * @param episodeId - episode identifier
 * @param edition - edition number
 * @returns version id
 */
export function versionId(episodeId: string, edition: number): string {
	return `${episodeId}:v${edition}`
}

/**
 * Parse a version id produced by versionId.
 *
 * @param value - version id string
 * @returns parsed parts, or null when malformed
 */
export function parseVersionId(
	value: string,
): { episodeId: string; edition: number } | null {
	const match = /^([a-z0-9][a-z0-9_-]*):v(\d+)$/.exec(value)
	if (match === null) return null
	const edition = Number(match[2])
	if (edition < 1) return null
	return { episodeId: match[1], edition }
}

/**
 * Guard against keys that would leave the media namespace.
 *
 * @param key - key to check (already normalized)
 * @param vaultPrefix - vault prefix that must never be addressed for media
 * @throws ValidationError when the key escapes media keyspace
 */
export function assertMediaKey(key: string, vaultPrefix: string): void {
	const normalized = normalizeKey(key)
	if (normalized.includes('..'))
		throw new ValidationError('object key must not contain ..')
	if (normalized.startsWith(`${vaultPrefix}/`) || normalized === vaultPrefix) {
		throw new ValidationError('media operations must not address vault keys')
	}
	if (normalized.includes('://'))
		throw new ValidationError('object key must be a relative key')
}
