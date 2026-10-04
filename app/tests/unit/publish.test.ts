import { describe, expect, it } from 'vitest'
import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from '../../src/lib/errors.js'
import {
	type PublishDeps,
	publishVideo,
	unpublishVideo,
} from '../../src/lib/publish/pointer.js'
import { inMemoryS3 } from '../../src/lib/s3.js'
import { fakeNotes } from '../helpers/fakes.js'

const KEY =
	'2026/bodhgaya/recordings/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/playback.mp4'
const POINTER = KEY.replace('playback.mp4', 'published.pointer.json')
const PATH = 'videos/bodhicitta-part-1.md'

const verifiedFm = {
	title: 'Bodhicitta Part 1',
	description: '',
	visibility: 'private',
	publication_state: 'draft',
	content_tier: 'recording',
	year: 2026,
	place_iri: 'http://sws.geonames.org/1252634',
	place_slug: 'bodhgaya',
	event_id: 'evt_2026_winter',
	event_slug: 'winter-retreat-2026',
	episode_id: 'ep_abcd1234',
	episode_slug: 'bodhicitta-part-1',
	edition: 1,
	verified: true,
	private_object_key: KEY,
	source_episode_ids: [],
	source_version_ids: [],
	source_ranges: [],
}

function setup(fmOverride: Record<string, unknown> = {}) {
	const s3 = inMemoryS3({ [`priv/${KEY}`]: 'MASTER-BYTES' })
	const { client } = fakeNotes({
		[PATH]: { frontmatter: { ...verifiedFm, ...fmOverride }, body: 'b' },
	})
	const deps: PublishDeps = {
		notes: client,
		s3,
		privateBucket: 'priv',
		publicBucket: 'pub',
		publicBaseUrl: 'http://media.example.org',
		now: () => new Date('2026-10-04T12:00:00Z'),
	}
	return { deps, s3 }
}

describe('pointer publish state machine (ADR-0003)', () => {
	it('publishes a verified draft: copy, pointer, frontmatter', async () => {
		const { deps, s3 } = setup()
		const pointer = await publishVideo(deps, 'bodhicitta-part-1')
		expect(pointer.kind).toBe('oxivault-public-pointer/v1')
		expect(pointer.source_bucket).toBe('priv')
		expect(pointer.target_bucket).toBe('pub')
		expect(pointer.source_key).toBe(KEY)
		expect(pointer.target_key).toBe(KEY)
		expect(pointer.public_url).toBe(`http://media.example.org/${KEY}`)
		expect(pointer.published_at).toBe('2026-10-04T12:00:00.000Z')
		expect(s3.store.has(`pub/${KEY}`)).toBe(true)
		expect(s3.store.has(`priv/${POINTER}`)).toBe(true)
		// The private source is never deleted.
		expect(s3.store.has(`priv/${KEY}`)).toBe(true)
	})

	it('is idempotent: a second publish converges without re-copying', async () => {
		const { deps, s3 } = setup()
		const first = await publishVideo(deps, 'bodhicitta-part-1')
		const targetEtag = s3.store.get(`pub/${KEY}`)!.etag
		// Mutate the target so a re-copy would be observable (it should not happen).
		s3.store.delete(`pub/${KEY}`)
		const second = await publishVideo(deps, 'bodhicitta-part-1')
		expect(second).toEqual(first)
		expect(s3.store.get(`pub/${KEY}`)!.etag).toBe(targetEtag)
	})

	it('re-copies when the pointer exists but the target drifted', async () => {
		const { deps, s3 } = setup()
		await publishVideo(deps, 'bodhicitta-part-1')
		s3.store.delete(`pub/${KEY}`)
		await publishVideo(deps, 'bodhicitta-part-1')
		expect(s3.store.has(`pub/${KEY}`)).toBe(true)
	})

	it('recovers from a crash before the metadata update', async () => {
		const { deps, s3 } = setup()
		// Simulate: copy + pointer done, frontmatter not yet (crash after step 4).
		await s3.copyObject('priv', KEY, 'pub', KEY)
		await publishVideo(deps, 'bodhicitta-part-1')
		const note = await deps.notes.getNote(PATH)
		expect(note.frontmatter.publication_state).toBe('published')
		expect(note.frontmatter.public_object_key).toBe(KEY)
		expect(note.frontmatter.pointer_key).toBe(POINTER)
		expect(note.frontmatter.visibility).toBe('public')
	})

	it('refuses to publish an unverified version', async () => {
		const { deps } = setup({ verified: false })
		await expect(publishVideo(deps, 'bodhicitta-part-1')).rejects.toThrowError(
			ValidationError,
		)
	})

	it('fails closed when the source object is missing', async () => {
		const { deps, s3 } = setup()
		s3.store.delete(`priv/${KEY}`)
		await expect(publishVideo(deps, 'bodhicitta-part-1')).rejects.toThrowError(
			NotFoundError,
		)
	})

	it('retries on concurrent frontmatter edits and converges', async () => {
		const { deps } = setupWithConflict()
		const pointer = await publishVideo(deps, 'bodhicitta-part-1')
		expect(pointer.kind).toBe('oxivault-public-pointer/v1')
		const note = await deps.notes.getNote(PATH)
		expect(note.frontmatter.publication_state).toBe('published')
	})

	it('gives up after the retry bound', async () => {
		const { deps } = setupAlwaysConflict()
		await expect(publishVideo(deps, 'bodhicitta-part-1')).rejects.toThrowError(
			ConflictError,
		)
	})
})

describe('unpublish (ADR-0003 inverse)', () => {
	async function publishedSetup() {
		const ctx = setup()
		await publishVideo(ctx.deps, 'bodhicitta-part-1')
		return ctx
	}

	it('restores private state: public object and pointer removed, source kept', async () => {
		const { deps, s3 } = await publishedSetup()
		await unpublishVideo(deps, 'bodhicitta-part-1')
		expect(s3.store.has(`pub/${KEY}`)).toBe(false)
		expect(s3.store.has(`priv/${POINTER}`)).toBe(false)
		expect(s3.store.has(`priv/${KEY}`)).toBe(true)
		const note = await deps.notes.getNote(PATH)
		expect(note.frontmatter.publication_state).toBe('draft')
		expect(note.frontmatter.visibility).toBe('private')
		expect(note.frontmatter.public_object_key).toBeUndefined()
		expect(note.frontmatter.pointer_key).toBeUndefined()
	})

	it('refuses when the note is not published', async () => {
		const { deps } = setup()
		await expect(
			unpublishVideo(deps, 'bodhicitta-part-1'),
		).rejects.toThrowError(ValidationError)
	})

	it('fails closed when the private source vanished', async () => {
		const { deps, s3 } = await publishedSetup()
		s3.store.delete(`priv/${KEY}`)
		await expect(
			unpublishVideo(deps, 'bodhicitta-part-1'),
		).rejects.toThrowError(NotFoundError)
		expect(s3.store.has(`pub/${KEY}`)).toBe(true)
	})

	it('is idempotent when the public objects are already gone', async () => {
		const { deps, s3 } = await publishedSetup()
		s3.store.delete(`pub/${KEY}`)
		s3.store.delete(`priv/${POINTER}`)
		await expect(
			unpublishVideo(deps, 'bodhicitta-part-1'),
		).resolves.toBeUndefined()
		const note = await deps.notes.getNote(PATH)
		expect(note.frontmatter.publication_state).toBe('draft')
	})
})

// --- conflict-injection helpers -------------------------------------------------

function setupWithConflict() {
	const s3 = inMemoryS3({ [`priv/${KEY}`]: 'MASTER-BYTES' })
	const base = fakeNotes({
		[PATH]: { frontmatter: { ...verifiedFm }, body: 'b' },
	})
	let conflictInjected = false
	const realPutNote = base.client.putNote.bind(base.client)
	const client = {
		...base.client,
		putNote: (
			path: string,
			fm: Record<string, unknown>,
			body: string,
			opts?: { ifMatch?: string; ifNoneMatchStar?: boolean },
		) => {
			if (opts?.ifMatch !== undefined && !conflictInjected) {
				conflictInjected = true
				// A concurrent editor bumped the etag under us.
				const current = base.notes.get(path)!
				current.etag = `bumped-${current.etag}`
				return Promise.reject(new ConflictError('note conflict (stale etag)'))
			}
			return realPutNote(path, fm, body, opts)
		},
	}
	return {
		deps: {
			notes: client,
			s3,
			privateBucket: 'priv',
			publicBucket: 'pub',
			publicBaseUrl: 'http://media.example.org',
			now: () => new Date('2026-10-04T12:00:00Z'),
		} satisfies PublishDeps,
		get conflictSeen(): boolean {
			return conflictInjected
		},
	}
}

function setupAlwaysConflict() {
	const s3 = inMemoryS3({ [`priv/${KEY}`]: 'MASTER-BYTES' })
	const base = fakeNotes({
		[PATH]: { frontmatter: { ...verifiedFm }, body: 'b' },
	})
	const client = {
		...base.client,
		putNote: () => Promise.reject(new ConflictError('always')),
	}
	return {
		deps: {
			notes: client,
			s3,
			privateBucket: 'priv',
			publicBucket: 'pub',
			publicBaseUrl: 'http://media.example.org',
			maxAttempts: 3,
		} satisfies PublishDeps,
	}
}
