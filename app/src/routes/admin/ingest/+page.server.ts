import { error, fail } from '@sveltejs/kit'
import { requireRole, sessionFromCookies } from '$lib/auth/guards.js'
import { getDeps } from '$lib/deps.js'
import { AppError, ConflictError, NotFoundError } from '$lib/errors.js'
import {
	type CreatedVideo,
	completeIngest,
	createVideo,
	type IngestInput,
	validateIngestInput,
} from '$lib/ingest.js'
import type { Actions, PageServerLoad } from './$types'

function ingestDeps(deps: Awaited<ReturnType<typeof getDeps>>) {
	return {
		notes: deps.notes,
		s3: deps.s3,
		privateBucket: deps.cfg.s3.privateBucket,
		vaultPrefix: deps.cfg.s3.vaultPrefix,
		places: deps.places,
		events: deps.events,
	}
}

async function librarianSession(request: Request) {
	const deps = await getDeps()
	const claims = await sessionFromCookies(
		request.headers.get('cookie'),
		deps.cfg.session.cookie,
		deps.cfg.session.secret,
	)
	try {
		return { deps, claims: requireRole(claims, 'librarian') }
	} catch (err) {
		if (err instanceof AppError) throw error(err.status, err.message)
		throw err
	}
}

export const load: PageServerLoad = async ({ request }) => {
	await librarianSession(request)
	return { upload: null as CreatedVideo | null, issues: [] as string[] }
}

function toInput(raw: FormData): Record<string, string | unknown> {
	const out: Record<string, string | unknown> = {}
	for (const [key, value] of raw.entries()) {
		if (typeof value === 'string') out[key] = value
	}
	const ranges: {
		source_version_id: string
		start_seconds: number
		end_seconds: number
	}[] = []
	const rawRanges = raw.get('source_ranges')
	if (typeof rawRanges === 'string' && rawRanges.trim() !== '') {
		try {
			const parsed: unknown = JSON.parse(rawRanges)
			if (Array.isArray(parsed)) {
				for (const r of parsed) {
					if (typeof r === 'object' && r !== null) {
						const row = r as Record<string, unknown>
						ranges.push({
							source_version_id: String(row.source_version_id ?? ''),
							start_seconds: Number(row.start_seconds ?? 0),
							end_seconds: Number(row.end_seconds ?? 0),
						})
					}
				}
			}
		} catch {
			// reported by validation as missing/invalid ranges
		}
	}
	if (ranges.length > 0) out.source_ranges = ranges
	return out
}

export const actions: Actions = {
	default: async ({ request }) => {
		const { deps } = await librarianSession(request)
		const form = await request.formData()
		const { input, issues } = validateIngestInput(toInput(form), {
			places: deps.places,
			events: deps.events,
		})
		if (issues.length > 0) return fail(400, { issues, upload: null })
		try {
			const created = await createVideo(ingestDeps(deps), input as IngestInput)
			return { issues: [], upload: created }
		} catch (err) {
			if (err instanceof ConflictError) {
				return fail(409, {
					issues: [`a video with slug ${input.episodeSlug} already exists`],
					upload: null,
				})
			}
			throw err
		}
	},
	complete: async ({ request }) => {
		await librarianSession(request)
		const form = await request.formData()
		const slug = String(form.get('slug') ?? '')
		const probeRaw = String(form.get('probe') ?? '')
		let probe: unknown
		try {
			probe = JSON.parse(probeRaw)
		} catch {
			return fail(400, {
				issues: ['probe must be a JSON object'],
				upload: null,
			})
		}
		const deps = await getDeps()
		try {
			await completeIngest(deps, slug, probe)
			return { issues: [], upload: null }
		} catch (err) {
			if (err instanceof NotFoundError)
				return fail(404, { issues: [`video ${slug} not found`], upload: null })
			if (err instanceof AppError)
				return fail(err.status, { issues: [err.message], upload: null })
			throw err
		}
	},
}
