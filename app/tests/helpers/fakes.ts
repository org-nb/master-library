import { AppError, ConflictError, NotFoundError } from '../../src/lib/errors.js'
import type { Note, OxivaultClient } from '../../src/lib/oxivault/client.js'

export interface FakeNote {
	frontmatter: Record<string, unknown>
	body: string
	etag: string
}

/**
 * In-memory OxivaultClient for unit tests.
 *
 * Mimics the 0.2.1 conditional-write semantics: putNote honours
 * If-Match / If-None-Match and bumps the etag on every write.
 */
export function fakeNotes(
	initial: Record<string, Omit<FakeNote, 'etag'>> = {},
): {
	client: OxivaultClient
	notes: Map<string, FakeNote>
} {
	const notes = new Map<string, FakeNote>()
	let counter = 1000
	const etagFor = () => {
		counter += 1
		return `etag-${counter}`
	}
	for (const [path, note] of Object.entries(initial)) {
		notes.set(path, { ...note, etag: etagFor() })
	}

	const client: OxivaultClient = {
		async vaultInfo() {
			return { noteCount: notes.size, tripleCount: 0 }
		},
		async listNotes(prefix = '') {
			return [...notes.entries()]
				.filter(([path]) => path.startsWith(prefix))
				.map(([path, n]) => ({
					path,
					etag: n.etag,
					frontmatter: { ...n.frontmatter },
				}))
		},
		async getNote(path) {
			const note = notes.get(path)
			if (note === undefined) throw new NotFoundError('note not found')
			const out: Note = {
				path,
				etag: note.etag,
				frontmatter: { ...note.frontmatter },
				body: note.body,
			}
			return out
		},
		async putNote(path, frontmatter, body, opts) {
			const existing = notes.get(path)
			if (opts?.ifNoneMatchStar && existing !== undefined)
				throw new ConflictError('note exists')
			if (opts?.ifMatch !== undefined && existing?.etag !== opts.ifMatch) {
				throw new ConflictError('note conflict (stale etag)')
			}
			const updated: FakeNote = {
				frontmatter: { ...frontmatter },
				body,
				etag: existing === undefined ? etagFor() : etagFor(),
			}
			notes.set(path, updated)
			return {
				path,
				etag: updated.etag,
				frontmatter: { ...updated.frontmatter },
				body: updated.body,
			}
		},
		async deleteNote(path) {
			if (!notes.delete(path)) throw new NotFoundError('note not found')
		},
		async search(query) {
			const bodyNotes = [...notes.entries()]
				.filter(([, n]) => n.body.toLowerCase().includes(query.toLowerCase()))
				.map(([path]) => path)
			return { triples: [], bodyNotes }
		},
		async edges() {
			return []
		},
		async sparql() {
			return []
		},
	}
	return { client, notes }
}

export { AppError, ConflictError, NotFoundError }
