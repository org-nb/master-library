import { describe, expect, it } from 'vitest'
import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from '../../src/lib/errors.js'
import {
	completeIngest,
	createVideo,
	type IngestDeps,
	validateIngestInput,
} from '../../src/lib/ingest.js'
import { loadEventRegistry, loadPlaceRegistry } from '../../src/lib/registry.js'
import { inMemoryS3 } from '../../src/lib/s3.js'
import { fakeNotes } from '../helpers/fakes.js'

const places = loadPlaceRegistry([
	{
		iri: 'http://sws.geonames.org/1252634',
		slug: 'bodhgaya',
		label: 'Bodh Gaya',
	},
])
const events = loadEventRegistry([
	{ id: 'evt_2026_winter', slug: 'winter-retreat-2026', title: 'Winter' },
])

function deps(): IngestDeps {
	const { client } = fakeNotes()
	return {
		notes: client,
		s3: inMemoryS3(),
		privateBucket: 'priv',
		vaultPrefix: 'vault',
		places,
		events,
	}
}

const validInput = {
	title: 'Bodhicitta Part 1',
	description: '',
	year: 2026,
	place_iri: 'http://sws.geonames.org/1252634',
	event_id: 'evt_2026_winter',
	episode_id: 'ep_abcd1234',
	episode_slug: 'bodhicitta-part-1',
	content_tier: 'recording',
	edition: 1,
}

describe('ingest validation', () => {
	it('accepts valid input and resolves registries', () => {
		const { input, issues } = validateIngestInput(validInput, {
			places,
			events,
		})
		expect(issues).toEqual([])
		expect(input.placeIri).toBe('http://sws.geonames.org/1252634')
		expect(input.contentTier).toBe('recording')
	})

	it('reports unregistered place and event together', () => {
		const { issues } = validateIngestInput(
			{
				...validInput,
				place_iri: 'http://unknown.example/x',
				event_id: 'evt_missing',
			},
			{ places, events },
		)
		expect(issues).toHaveLength(2)
		expect(issues[0]).toContain('place registry')
		expect(issues[1]).toContain('event registry')
	})

	it('enforces lineage rules for derived items', () => {
		const { issues } = validateIngestInput(
			{
				...validInput,
				content_tier: 'short',
				episode_slug: 'quote',
				source_episode_ids: ['ep_x'],
				source_version_ids: ['ep_x:v1'],
				source_ranges: [
					{ source_version_id: 'ep_x:v1', start_seconds: 10, end_seconds: 5 },
				],
			},
			{ places, events },
		)
		expect(issues).toContain(
			'source range end_seconds must be greater than start_seconds',
		)
	})
})

describe('createVideo', () => {
	it('creates a private draft note and mints a presigned key', async () => {
		const d = deps()
		const { input, issues } = validateIngestInput(validInput, {
			places,
			events,
		})
		expect(issues).toEqual([])
		const created = await createVideo(d, input)
		expect(created.slug).toBe('bodhicitta-part-1')
		expect(created.key).toBe(
			'2026/bodhgaya/recordings/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/playback.mp4',
		)
		expect(created.uploadUrl).toContain('priv/')
		const note = await d.notes.getNote('videos/bodhicitta-part-1.md')
		expect(note.frontmatter.visibility).toBe('private')
		expect(note.frontmatter.verified).toBe(false)
		expect(note.frontmatter.private_object_key).toBe(created.key)
	})

	it('conflicts on a duplicate slug', async () => {
		const d = deps()
		const { input } = validateIngestInput(validInput, { places, events })
		await createVideo(d, input)
		await expect(createVideo(d, input)).rejects.toThrowError(ConflictError)
	})
})

describe('completeIngest', () => {
	const goodProbe = {
		video_codec: 'h264',
		audio_codec: 'aac',
		duration_seconds: 7140,
		byte_size: 2831046400,
		sha256: 'a'.repeat(64),
	}

	it('marks the version verified with probe facts', async () => {
		const d = deps()
		const { input } = validateIngestInput(validInput, { places, events })
		await createVideo(d, input)
		await completeIngest(d, 'bodhicitta-part-1', goodProbe)
		const note = await d.notes.getNote('videos/bodhicitta-part-1.md')
		expect(note.frontmatter.verified).toBe(true)
		expect(note.frontmatter.duration_seconds).toBe(7140)
		expect(note.frontmatter.byte_size).toBe(2831046400)
	})

	it('rejects unsupported codecs', async () => {
		const d = deps()
		const { input } = validateIngestInput(validInput, { places, events })
		await createVideo(d, input)
		await expect(
			completeIngest(d, 'bodhicitta-part-1', {
				...goodProbe,
				video_codec: 'vp9',
			}),
		).rejects.toThrowError(ValidationError)
	})

	it('404s for unknown slugs', async () => {
		const d = deps()
		await expect(completeIngest(d, 'missing', goodProbe)).rejects.toThrowError(
			NotFoundError,
		)
	})
})
