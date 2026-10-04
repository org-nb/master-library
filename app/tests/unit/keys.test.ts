import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/lib/errors.js'
import {
	assertMediaKey,
	buildPlaybackKey,
	buildPointerKey,
	type KeyMeta,
	normalizeKey,
	parseVersionId,
	versionId,
} from '../../src/lib/keys.js'

const meta: KeyMeta = {
	year: 2026,
	placeSlug: 'bodhgaya',
	contentTier: 'recording',
	eventId: 'evt_2026_winter',
	eventSlug: 'winter-retreat-2026',
	episodeId: 'ep_abcd1234',
	episodeSlug: 'bodhicitta-part-1',
	edition: 1,
}

describe('canonical keys (ADR-0003)', () => {
	it('builds the canonical playback key', () => {
		expect(buildPlaybackKey(meta)).toBe(
			'2026/bodhgaya/recordings/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/playback.mp4',
		)
	})

	it('maps tiers to their directory segments', () => {
		expect(buildPlaybackKey({ ...meta, contentTier: 'edit' })).toContain(
			'/edits/',
		)
		expect(buildPlaybackKey({ ...meta, contentTier: 'short' })).toContain(
			'/shorts/',
		)
	})

	it('builds the pointer key under the same stem', () => {
		const pointerKey = buildPointerKey(meta)
		expect(pointerKey).toBe(
			'2026/bodhgaya/recordings/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/published.pointer.json',
		)
		expect(pointerKey).not.toMatch(/playback\.mp4/)
	})

	it('contains no leading slash', () => {
		expect(buildPlaybackKey(meta).startsWith('/')).toBe(false)
	})

	it('normalizes a display leading slash away', () => {
		expect(normalizeKey('/2026/bodhgaya/x')).toBe('2026/bodhgaya/x')
		expect(() => normalizeKey('/')).toThrowError(ValidationError)
	})

	it('rejects bad slugs, ids, years and editions with all problems listed', () => {
		expect(() =>
			buildPlaybackKey({
				...meta,
				placeSlug: 'Bad Slug',
				year: 1899,
				edition: 0,
				episodeId: 'bad slug',
			}),
		).toThrowError(ValidationError)
		try {
			buildPlaybackKey({
				...meta,
				placeSlug: 'Bad Slug',
				year: 1899,
				edition: 0,
				episodeId: 'bad slug',
			})
		} catch (err) {
			expect((err as ValidationError).issues).toHaveLength(4)
		}
	})

	it('rejects unknown tiers', () => {
		expect(() =>
			buildPlaybackKey({ ...meta, contentTier: 'trailer' as never }),
		).toThrowError(ValidationError)
	})

	it('builds and parses version ids', () => {
		expect(versionId('ep_x', 2)).toBe('ep_x:v2')
		expect(parseVersionId('ep_x:v2')).toEqual({ episodeId: 'ep_x', edition: 2 })
		expect(parseVersionId('ep_x:v0')).toBeNull()
		expect(parseVersionId('nope')).toBeNull()
	})

	it('blocks traversal, absolute and vault-prefixed media keys', () => {
		expect(() => assertMediaKey('../secrets', 'vault')).toThrowError(
			ValidationError,
		)
		expect(() => assertMediaKey('vault/notes/a.md', 'vault')).toThrowError(
			ValidationError,
		)
		expect(() =>
			assertMediaKey('https://evil.example/x', 'vault'),
		).toThrowError(ValidationError)
		assertMediaKey('2026/bodhgaya/a.mp4', 'vault')
	})
})
