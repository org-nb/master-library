import { describe, expect, it } from 'vitest'
import {
	isMemberPlayable,
	isPublished,
	publicPlaybackUrl,
	relatedNotes,
} from '../../src/lib/catalog/catalog.js'
import { parseFrontmatter } from '../../src/lib/catalog/frontmatter.js'

const published = parseFrontmatter({
	title: 'Published',
	content_tier: 'edit',
	year: 2026,
	place_iri: 'http://sws.geonames.org/1252634',
	place_slug: 'bodhgaya',
	event_id: 'evt_2026_winter',
	event_slug: 'winter-retreat-2026',
	episode_id: 'ep_pub',
	episode_slug: 'published-clip',
	verified: true,
	visibility: 'public',
	publication_state: 'published',
	private_object_key: '2026/bodhgaya/edits/x/v1/playback.mp4',
	public_object_key: '2026/bodhgaya/edits/x/v1/playback.mp4',
})

const draft = parseFrontmatter({
	title: 'Draft',
	content_tier: 'recording',
	year: 2026,
	place_iri: 'http://sws.geonames.org/1252634',
	place_slug: 'bodhgaya',
	event_id: 'evt_2026_winter',
	event_slug: 'winter-retreat-2026',
	episode_id: 'ep_draft',
	episode_slug: 'draft-clip',
	verified: true,
	private_object_key: '2026/bodhgaya/recordings/x/v1/playback.mp4',
})

describe('catalog visibility', () => {
	it('publishes only with public visibility, published state and a public key', () => {
		expect(isPublished(published)).toBe(true)
		expect(isPublished({ ...published, publication_state: 'publishing' })).toBe(
			false,
		)
		expect(isPublished({ ...published, public_object_key: undefined })).toBe(
			false,
		)
		expect(isPublished(draft)).toBe(false)
	})

	it('member playback requires verified + private key', () => {
		expect(isMemberPlayable(draft)).toBe(true)
		expect(isMemberPlayable({ ...draft, verified: false })).toBe(false)
		expect(isMemberPlayable(published)).toBe(true)
	})

	it('builds public playback URLs from the media domain', () => {
		expect(
			publicPlaybackUrl(
				{ publicMediaBaseUrl: 'http://media.example.org' },
				published,
			),
		).toBe('http://media.example.org/2026/bodhgaya/edits/x/v1/playback.mp4')
		expect(
			publicPlaybackUrl(
				{ publicMediaBaseUrl: 'http://media.example.org' },
				draft,
			),
		).toBeNull()
	})

	it('relates items by shared event or direct lineage', () => {
		const source = parseFrontmatter({
			title: 'Source',
			content_tier: 'recording',
			year: 2026,
			place_iri: 'http://sws.geonames.org/1252634',
			place_slug: 'bodhgaya',
			event_id: 'evt_2026_winter',
			event_slug: 'winter-retreat-2026',
			episode_id: 'ep_source',
			episode_slug: 'source-rec',
		})
		const derived = parseFrontmatter({
			title: 'Derived',
			content_tier: 'short',
			year: 2026,
			place_iri: 'http://sws.geonames.org/1252634',
			place_slug: 'bodhgaya',
			event_id: 'evt_2026_spring',
			event_slug: 'spring-teachings-2026',
			episode_id: 'ep_derived',
			episode_slug: 'derived-short',
			source_episode_ids: ['ep_source'],
			source_version_ids: ['ep_source:v1'],
			source_ranges: [
				{
					source_version_id: 'ep_source:v1',
					start_seconds: 0,
					end_seconds: 60,
				},
			],
		})
		const all = [source, derived]
		const relatedToSource = relatedNotes(all, source)
		expect(relatedToSource.map((n) => n.episode_id)).toEqual(['ep_derived'])
		// symmetric: derived relates back to its source even though events differ
		const relatedToDerived = relatedNotes(all, derived)
		expect(relatedToDerived.map((n) => n.episode_id)).toEqual(['ep_source'])
	})
})
