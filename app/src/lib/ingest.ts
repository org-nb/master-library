import { z } from 'zod'
import { parseFrontmatter, videoPath } from './catalog/frontmatter.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { assertMediaKey, buildPlaybackKey, versionId } from './keys.js'
import { validateLineage } from './lineage.js'
import type { OxivaultClient } from './oxivault/client.js'
import {
	type EventRegistry,
	type PlaceRegistry,
	slugForEventId,
	slugForPlaceIri,
} from './registry.js'
import type { S3Ops } from './s3.js'

/** ffprobe report contract: validated H.264/AAC MP4 only (ADR-0003). */
export const probeReport = z.object({
	video_codec: z.literal('h264'),
	audio_codec: z.literal('aac'),
	duration_seconds: z.number().positive(),
	byte_size: z.number().positive(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export type ProbeReport = z.infer<typeof probeReport>

export interface IngestInput {
	title: string
	description: string
	year: number
	placeIri: string
	eventId: string
	episodeId: string
	episodeSlug: string
	contentTier: 'recording' | 'edit' | 'short'
	edition: number
	sourceEpisodeIds: string[]
	sourceVersionIds: string[]
	sourceRanges: {
		sourceVersionId: string
		startSeconds: number
		endSeconds: number
	}[]
}

const inputSchema = z.object({
	title: z.string().min(1).max(300),
	description: z.string().max(5000).default(''),
	year: z.coerce.number().int().min(1900).max(2100),
	place_iri: z.string().url(),
	event_id: z.string().min(1),
	episode_id: z.string().min(1),
	episode_slug: z.string().min(1),
	content_tier: z.enum(['recording', 'edit', 'short']),
	edition: z.coerce.number().int().min(1).default(1),
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

export interface IngestDeps {
	notes: OxivaultClient
	s3: S3Ops
	privateBucket: string
	vaultPrefix: string
	places: PlaceRegistry
	events: EventRegistry
	/** Presign lifetime for browser uploads, seconds. */
	uploadExpirySeconds?: number
}

/**
 * Validate ingest input against the registries and lineage rules.
 *
 * Pure: no I/O. Collects every problem so the UI can show them together.
 *
 * @param raw - form payload
 * @param deps - registries (places, events)
 * @returns validated input, or the list of problems
 */
export function validateIngestInput(
	raw: Record<string, string | unknown>,
	deps: Pick<IngestDeps, 'places' | 'events'>,
): { input: IngestInput; issues: string[] } {
	const issues: string[] = []
	const parsed = inputSchema.safeParse(raw)
	if (!parsed.success) {
		return {
			input: failInput,
			issues: parsed.error.issues.map(
				(i) => `${i.path.join('.')}: ${i.message}`,
			),
		}
	}
	const data = parsed.data

	const placeSlug = slugForPlaceIri(deps.places, data.place_iri)
	if (placeSlug === null)
		issues.push(`place ${data.place_iri} is not in the place registry`)
	const eventSlug = slugForEventId(deps.events, data.event_id)
	if (eventSlug === null)
		issues.push(`event ${data.event_id} is not in the event registry`)

	issues.push(
		...validateLineage({
			contentTier: data.content_tier,
			sourceEpisodeIds: data.source_episode_ids,
			sourceVersionIds: data.source_version_ids,
			sourceRanges: data.source_ranges.map((r) => ({
				sourceVersionId: r.source_version_id,
				startSeconds: r.start_seconds,
				endSeconds: r.end_seconds,
			})),
		}),
	)

	if (issues.length > 0) return { input: failInput, issues }

	return {
		input: {
			title: data.title,
			description: data.description,
			year: data.year,
			placeIri: data.place_iri,
			eventId: data.event_id,
			episodeId: data.episode_id,
			episodeSlug: data.episode_slug,
			contentTier: data.content_tier,
			edition: data.edition,
			sourceEpisodeIds: data.source_episode_ids,
			sourceVersionIds: data.source_version_ids,
			sourceRanges: data.source_ranges.map((r) => ({
				sourceVersionId: r.source_version_id,
				startSeconds: r.start_seconds,
				endSeconds: r.end_seconds,
			})),
		},
		issues: [],
	}
}

const failInput: IngestInput = {
	title: '',
	description: '',
	year: 0,
	placeIri: '',
	eventId: '',
	episodeId: '',
	episodeSlug: '',
	contentTier: 'recording',
	edition: 0,
	sourceEpisodeIds: [],
	sourceVersionIds: [],
	sourceRanges: [],
}

export interface CreatedVideo {
	slug: string
	path: string
	key: string
	uploadUrl: string
}

/**
 * Create a private draft video note and mint a presigned upload URL for
 * its canonical key (ADR-0003 ingest flow).
 *
 * The key is built from validated metadata only; duplicate slugs yield a
 * ConflictError (409).
 *
 * @param deps - ingest dependencies
 * @param input - validated ingest input (from validateIngestInput)
 * @returns created note and upload URL
 */
export async function createVideo(
	deps: IngestDeps,
	input: IngestInput,
): Promise<CreatedVideo> {
	const placeSlug = slugForPlaceIri(deps.places, input.placeIri)
	const eventSlug = slugForEventId(deps.events, input.eventId)
	if (placeSlug === null || eventSlug === null) {
		throw new ValidationError('registry lookup failed after validation')
	}
	const meta = {
		year: input.year,
		placeSlug,
		contentTier: input.contentTier,
		eventId: input.eventId,
		eventSlug,
		episodeId: input.episodeId,
		episodeSlug: input.episodeSlug,
		edition: input.edition,
	}
	const key = buildPlaybackKey(meta)
	assertMediaKey(key, deps.vaultPrefix)

	const frontmatter: Record<string, unknown> = {
		type: 'VideoEpisode',
		title: input.title,
		description: input.description,
		visibility: 'private',
		publication_state: 'draft',
		content_tier: input.contentTier,
		year: input.year,
		place_iri: input.placeIri,
		place_slug: placeSlug,
		event_id: input.eventId,
		event_slug: eventSlug,
		episode_id: input.episodeId,
		episode_slug: input.episodeSlug,
		edition: input.edition,
		verified: false,
		private_object_key: key,
		source_episode_ids: input.sourceEpisodeIds,
		source_version_ids: input.sourceVersionIds,
		source_ranges: input.sourceRanges.map((r) => ({
			source_version_id: r.sourceVersionId,
			start_seconds: r.startSeconds,
			end_seconds: r.endSeconds,
		})),
	}
	const path = videoPath(input.episodeSlug)
	await deps.notes.putNote(path, frontmatter, '', { ifNoneMatchStar: true })

	const uploadUrl = await deps.s3.presignPut(
		deps.privateBucket,
		key,
		deps.uploadExpirySeconds ?? 3600,
	)
	return { slug: input.episodeSlug, path, key, uploadUrl }
}

/**
 * Record a validated ffprobe report and mark the note's version verified.
 *
 * @param deps - ingest dependencies
 * @param slug - video slug
 * @param rawProbe - probe report payload
 * @returns updated frontmatter
 * @throws ValidationError when the probe report is invalid
 * @throws NotFoundError when the note does not exist
 */
export async function completeIngest(
	deps: Pick<IngestDeps, 'notes'>,
	slug: string,
	rawProbe: unknown,
): Promise<Record<string, unknown>> {
	const parsed = probeReport.safeParse(rawProbe)
	if (!parsed.success) {
		throw new ValidationError(
			'invalid probe report',
			parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
		)
	}
	const path = videoPath(slug)
	const note = await deps.notes.getNote(path)
	const fm = parseFrontmatter(note.frontmatter)
	if (fm.private_object_key === undefined)
		throw new ValidationError('note has no private_object_key')
	const update = {
		...note.frontmatter,
		verified: true,
		duration_seconds: parsed.data.duration_seconds,
		byte_size: parsed.data.byte_size,
		sha256: parsed.data.sha256,
	}
	await deps.notes.putNote(path, update, note.body, { ifMatch: note.etag })
	return update
}

export { ConflictError, NotFoundError, versionId }
