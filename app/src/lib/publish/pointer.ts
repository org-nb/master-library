import { parseFrontmatter, videoPath } from '../catalog/frontmatter.js'
import {
	AppError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from '../errors.js'
import { buildPlaybackKey, buildPointerKey } from '../keys.js'
import type { OxivaultClient } from '../oxivault/client.js'
import type { S3Ops } from '../s3.js'

/** Pointer document format (ADR-0003 `published.pointer.json`). */
export interface PointerDoc {
	kind: 'oxivault-public-pointer/v1'
	content_tier: string
	source_bucket: string
	source_key: string
	target_bucket: string
	target_key: string
	public_url: string
	etag: string
	published_at: string
}

export interface PublishDeps {
	notes: OxivaultClient
	s3: S3Ops
	privateBucket: string
	publicBucket: string
	publicBaseUrl: string
	/** Injectable clock for deterministic timestamps. */
	now?: () => Date
	/** Bounded retries on concurrent frontmatter modification. */
	maxAttempts?: number
}

const POINTER_KIND = 'oxivault-public-pointer/v1'

interface NoteState {
	path: string
	fm: Record<string, unknown>
	body: string
	etag: string
}

async function readNote(
	deps: Pick<PublishDeps, 'notes'>,
	path: string,
): Promise<NoteState> {
	const note = await deps.notes.getNote(path)
	return { path, fm: note.frontmatter, body: note.body, etag: note.etag }
}

/**
 * Apply frontmatter updates, deleting keys whose value is undefined.
 *
 * @throws ConflictError when the note's etag has moved
 */
async function putFrontmatter(
	deps: Pick<PublishDeps, 'notes'>,
	note: NoteState,
	updates: Record<string, unknown>,
): Promise<void> {
	const updated: Record<string, unknown> = { ...note.fm }
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) delete updated[key]
		else updated[key] = value
	}
	await deps.notes.putNote(note.path, updated, note.body, {
		ifMatch: note.etag,
	})
}

async function readPointer(
	deps: PublishDeps,
	pointerKey: string,
): Promise<PointerDoc | null> {
	let body: string
	try {
		body = await deps.s3.getObject(deps.privateBucket, pointerKey)
	} catch (err) {
		if (err instanceof NotFoundError) return null
		throw err
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		throw new AppError('pointer object is not valid JSON', 500)
	}
	const doc = parsed as PointerDoc
	if (doc.kind !== POINTER_KIND)
		throw new AppError('pointer kind mismatch', 500)
	return doc
}

/**
 * Resolve source/target/pointer keys from the note frontmatter.
 *
 * Prefers explicit keys; falls back to the canonical builder so notes
 * written before explicit key adoption still publish correctly.
 *
 * @throws ValidationError when frontmatter lacks key metadata
 */
function resolveKeys(fm: Record<string, unknown>): {
	sourceKey: string
	targetKey: string
	pointerKey: string
} {
	const meta = {
		year: fm.year as number,
		placeSlug: fm.place_slug as string,
		contentTier: fm.content_tier as 'recording' | 'edit' | 'short',
		eventId: fm.event_id as string,
		eventSlug: fm.event_slug as string,
		episodeId: fm.episode_id as string,
		episodeSlug: fm.episode_slug as string,
		edition: (fm.edition as number | undefined) ?? 1,
	}
	const targetKey = buildPlaybackKey(meta)
	const pointerKey = buildPointerKey(meta)
	const sourceKey =
		typeof fm.private_object_key === 'string' &&
		fm.private_object_key.length > 0
			? (fm.private_object_key as string)
			: targetKey
	return { sourceKey, targetKey, pointerKey }
}

/**
 * Publish a video (private -> public) per the ADR-0003 pointer state
 * machine.
 *
 * Idempotent and resumable: the state machine is keyed on the pointer and
 * the verified public object, never on the private source (which is never
 * deleted). Every step either verifies existing state or is a no-op when
 * replayed, so a rerun after any failure converges without special cases.
 *
 * @param deps - publish dependencies
 * @param slug - video slug
 * @returns the pointer document
 * @throws ValidationError when the note is not publishable
 * @throws NotFoundError when the note or source object is missing
 * @throws ConflictError when concurrent edits exhaust the retry bound
 */
export async function publishVideo(
	deps: PublishDeps,
	slug: string,
): Promise<PointerDoc> {
	const path = videoPath(slug)
	const maxAttempts = deps.maxAttempts ?? 3
	let lastConflict: ConflictError | undefined

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const note = await readNote(deps, path)
		const fm = parseFrontmatter(note.fm)

		if (fm.verified !== true)
			throw new ValidationError('cannot publish an unverified version')

		const { sourceKey, targetKey, pointerKey } = resolveKeys(note.fm)

		// Step 2: pointer exists and target verifies -> only metadata left.
		const pointer = await readPointer(deps, pointerKey)
		if (pointer !== null) {
			let targetVerified = false
			try {
				const target = await deps.s3.headObject(deps.publicBucket, targetKey)
				targetVerified = target.etag === pointer.etag
			} catch (err) {
				if (err instanceof NotFoundError) targetVerified = false
				else throw err
			}
			if (targetVerified) {
				await putFrontmatter(deps, note, {
					public_object_key: targetKey,
					pointer_key: pointerKey,
					publication_state: 'published',
					visibility: 'public',
				})
				return pointer
			}
			// Target drifted from the pointer: re-copy (copy is idempotent).
		}

		const source = await deps.s3.headObject(deps.privateBucket, sourceKey)

		// Step 3: copy + verify.
		await deps.s3.copyObject(
			deps.privateBucket,
			sourceKey,
			deps.publicBucket,
			targetKey,
		)
		const target = await deps.s3.headObject(deps.publicBucket, targetKey)
		if (target.size !== source.size) {
			throw new ValidationError('copy verification failed: size mismatch')
		}

		const now = (deps.now ?? (() => new Date()))().toISOString()
		const fresh: PointerDoc = {
			kind: POINTER_KIND,
			content_tier: fm.content_tier,
			source_bucket: deps.privateBucket,
			source_key: sourceKey,
			target_bucket: deps.publicBucket,
			target_key: targetKey,
			public_url: `${deps.publicBaseUrl}/${targetKey}`,
			etag: target.etag,
			published_at: now,
		}

		// Step 4: pointer object (write/overwrite).
		await deps.s3.putObject(
			deps.privateBucket,
			pointerKey,
			JSON.stringify(fresh, null, 2),
			'application/json',
		)

		// Step 5: metadata under optimistic concurrency.
		try {
			await putFrontmatter(deps, note, {
				public_object_key: targetKey,
				pointer_key: pointerKey,
				publication_state: 'published',
				visibility: 'public',
			})
			return fresh
		} catch (err) {
			if (err instanceof ConflictError) {
				lastConflict = err
				continue // re-read, re-verify, converge
			}
			throw err
		}
	}
	throw lastConflict ?? new ConflictError('publish conflicted after retries')
}

/**
 * Unpublish a video (public -> private) per the ADR-0003 inverse.
 *
 * The pointer is removed only after the private source is confirmed
 * present. Unpublish is editorial, not instant revocation: callers must
 * purge the media cache as a separate operational step.
 *
 * @param deps - publish dependencies
 * @param slug - video slug
 * @throws ValidationError when the note is not published
 * @throws NotFoundError when the note or private source is missing
 * @throws ConflictError when concurrent edits exhaust the retry bound
 */
export async function unpublishVideo(
	deps: PublishDeps,
	slug: string,
): Promise<void> {
	const path = videoPath(slug)
	const maxAttempts = deps.maxAttempts ?? 3
	let lastConflict: ConflictError | undefined

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const note = await readNote(deps, path)
		const fm = parseFrontmatter(note.fm)
		if (fm.publication_state !== 'published') {
			throw new ValidationError('note is not published')
		}
		const { sourceKey, targetKey, pointerKey } = resolveKeys(note.fm)

		// Step 1: private source must exist before removing anything public.
		await deps.s3.headObject(deps.privateBucket, sourceKey)

		// Step 2: delete the public playback object (idempotent).
		await deps.s3.deleteObject(deps.publicBucket, targetKey)
		// Step 3: delete the pointer.
		await deps.s3.deleteObject(deps.privateBucket, pointerKey)

		// Step 4: metadata under optimistic concurrency.
		try {
			await putFrontmatter(deps, note, {
				public_object_key: undefined,
				pointer_key: undefined,
				publication_state: 'draft',
				visibility: 'private',
			})
			return
		} catch (err) {
			if (err instanceof ConflictError) {
				lastConflict = err
				continue
			}
			throw err
		}
	}
	throw lastConflict ?? new ConflictError('unpublish conflicted after retries')
}
