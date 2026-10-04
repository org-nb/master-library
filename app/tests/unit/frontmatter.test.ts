import { describe, expect, it } from 'vitest'
import {
	noteFrontmatter,
	parseFrontmatter,
	slugFromPath,
	videoPath,
} from '../../src/lib/catalog/frontmatter.js'
import { ValidationError } from '../../src/lib/errors.js'

const base = {
	title: 'Bodhicitta Part 1',
	content_tier: 'recording',
	year: 2026,
	place_iri: 'http://sws.geonames.org/1252634',
	place_slug: 'bodhgaya',
	event_id: 'evt_2026_winter',
	event_slug: 'winter-retreat-2026',
	episode_id: 'ep_abcd1234',
	episode_slug: 'bodhicitta-part-1',
}

describe('note frontmatter', () => {
	it('applies safe defaults for a new private draft', () => {
		const fm = parseFrontmatter(base)
		expect(fm.visibility).toBe('private')
		expect(fm.publication_state).toBe('draft')
		expect(fm.verified).toBe(false)
		expect(fm.edition).toBe(1)
		expect(fm.source_episode_ids).toEqual([])
	})

	it('coerces numeric fields from strings', () => {
		const fm = parseFrontmatter({ ...base, year: '2025', edition: '2' })
		expect(fm.year).toBe(2025)
		expect(fm.edition).toBe(2)
	})

	it('lists every problem for malformed frontmatter', () => {
		expect(() =>
			parseFrontmatter({ ...base, content_tier: 'trailer', year: 1800 }),
		).toThrowError(ValidationError)
		try {
			parseFrontmatter({ ...base, content_tier: 'trailer', year: 1800 })
		} catch (err) {
			expect((err as ValidationError).issues).toHaveLength(2)
		}
	})

	it('rejects bad checksums', () => {
		expect(() => parseFrontmatter({ ...base, sha256: 'zz' })).toThrowError(
			ValidationError,
		)
	})

	it('round-trips through the zod schema', () => {
		const fm = parseFrontmatter(base)
		expect(noteFrontmatter.parse(fm).title).toBe('Bodhicitta Part 1')
	})

	it('maps note paths to slugs', () => {
		expect(videoPath('bodhicitta-part-1')).toBe('videos/bodhicitta-part-1.md')
		expect(slugFromPath('videos/bodhicitta-part-1.md')).toBe(
			'bodhicitta-part-1',
		)
		expect(slugFromPath('people/tkr.md')).toBeNull()
		expect(slugFromPath('videos/../etc.md')).toBeNull()
	})
})
