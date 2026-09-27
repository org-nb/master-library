import { describe, expect, it } from 'vitest'
import fixture from './fixtures/catalog-profile.json'

describe('catalog ontology profile fixture', () => {
	it('maps logical videos to po:Episode semantics with optional series grouping', () => {
		expect(fixture.series).toHaveLength(1)
		expect(fixture.videos).toHaveLength(2)

		for (const video of fixture.videos) {
			expect(video.id).toBeTruthy()
			expect(video.title).toBeTruthy()
			expect(video.series_id).toBe(fixture.series[0].id)
			expect(video.position).toBeGreaterThan(0)
			expect(video.versions.length).toBeGreaterThan(0)
		}
	})

	it('maps editions to po:Version with duration and asset copies', () => {
		const video1 = fixture.videos[0]
		expect(video1.versions).toHaveLength(2)

		const v1 = video1.versions[0]
		expect(v1.version_number).toBe(1)
		expect(v1.duration_seconds).toBe(1846)
		expect(v1.assets).toHaveLength(2)

		// Distinct provider copies for same timeline version
		const r2Asset = v1.assets.find((a) => a.location_id === 'loc-r2-dev')
		const streamAsset = v1.assets.find((a) => a.location_id === 'loc-stream-dev')
		expect(r2Asset).toBeDefined()
		expect(streamAsset).toBeDefined()
		expect(r2Asset?.is_source).toBe(true)
		expect(r2Asset?.playback_enabled).toBe(true)
		expect(streamAsset?.is_source).toBe(false)
		expect(streamAsset?.playback_enabled).toBe(true)
	})

	it('separates contributors (foaf:Person, po:credit) from subjects (po:Subject)', () => {
		const video1 = fixture.videos[0]
		expect(video1.contributors).toHaveLength(1)
		expect(video1.contributors[0].role).toBe('teacher')
		expect(fixture.people.some((p) => p.id === video1.contributors[0].person_id)).toBe(true)

		expect(video1.topics).toHaveLength(1)
		expect(fixture.topics.some((t) => t.id === video1.topics[0])).toBe(true)
	})
})
