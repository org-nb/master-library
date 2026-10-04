import {
	AppError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from '../errors.js'

export interface NoteSummary {
	path: string
	etag: string
	frontmatter: Record<string, unknown>
}

export interface Note extends NoteSummary {
	body: string
}

export interface SearchResult {
	triples: Record<string, unknown>[]
	bodyNotes: string[]
}

/**
 * Typed client for the oxivault 0.2.1 HTTP API (ADR-0004, slice A2).
 *
 * Thin transport layer: no business logic. HTTP failures are mapped to the
 * app error hierarchy so routes and callers never see raw statuses.
 */
export interface OxivaultClient {
	vaultInfo(): Promise<{ noteCount: number; tripleCount: number }>
	listNotes(prefix?: string): Promise<NoteSummary[]>
	getNote(path: string): Promise<Note>
	putNote(
		path: string,
		frontmatter: Record<string, unknown>,
		body: string,
		opts?: { ifMatch?: string; ifNoneMatchStar?: boolean },
	): Promise<Note>
	deleteNote(path: string): Promise<void>
	search(query: string): Promise<SearchResult>
	edges(subject: string): Promise<Record<string, unknown>[]>
	sparql(query: string): Promise<unknown[][]>
}

interface ClientOptions {
	baseUrl: string
	token: string
	fetchImpl?: typeof fetch
}

/**
 * Create an oxivault API client.
 *
 * @param opts - base URL, editor bearer token, injectable fetch for tests
 * @returns OxivaultClient
 */
export function createOxivaultClient(opts: ClientOptions): OxivaultClient {
	const doFetch = opts.fetchImpl ?? fetch

	async function request(path: string, init: RequestInit): Promise<unknown> {
		let response: Response
		try {
			response = await doFetch(`${opts.baseUrl}${path}`, {
				...init,
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${opts.token}`,
					...(init.headers ?? {}),
				},
			})
		} catch (err) {
			throw new AppError(
				`oxivault unreachable: ${err instanceof Error ? err.message : String(err)}`,
				502,
			)
		}
		if (response.status === 204) return null
		if (response.status === 404) throw new NotFoundError('note not found')
		if (response.status === 409)
			throw new ConflictError('note conflict (stale etag)')
		if (response.status === 400) {
			const body = (await response.json().catch(() => null)) as {
				detail?: string
			} | null
			throw new ValidationError(
				`oxivault rejected the request: ${body?.detail ?? 'bad request'}`,
			)
		}
		if (!response.ok) {
			throw new AppError(`oxivault returned ${response.status}`, 502)
		}
		return response.json()
	}

	const putNote = (
		path: string,
		frontmatter: Record<string, unknown>,
		body: string,
		opts?: { ifMatch?: string; ifNoneMatchStar?: boolean },
	): Promise<Note> => {
		const headers: Record<string, string> = {}
		if (opts?.ifMatch !== undefined) headers['if-match'] = opts.ifMatch
		if (opts?.ifNoneMatchStar) headers['if-none-match'] = '*'
		return request(`/notes/${path}`, {
			method: 'PUT',
			headers,
			body: JSON.stringify({ frontmatter, body }),
		}).then((raw) => raw as Note)
	}

	return {
		async vaultInfo() {
			const raw = (await request('/vault', { method: 'GET' })) as {
				note_count: number
				triple_count: number
			}
			return { noteCount: raw.note_count, tripleCount: raw.triple_count }
		},
		async listNotes(prefix = '') {
			const raw = (await request(
				`/notes${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`,
				{
					method: 'GET',
				},
			)) as { notes: NoteSummary[] }
			return raw.notes
		},
		async getNote(path) {
			return (await request(`/notes/${path}`, { method: 'GET' })) as Note
		},
		putNote,
		async deleteNote(path) {
			await request(`/notes/${path}`, { method: 'DELETE' })
		},
		async search(query) {
			const raw = (await request(`/search?q=${encodeURIComponent(query)}`, {
				method: 'GET',
			})) as { triples: Record<string, unknown>[]; body_notes: string[] }
			return { triples: raw.triples, bodyNotes: raw.body_notes }
		},
		async edges(subject) {
			const raw = (await request(
				`/graph/edges?subject=${encodeURIComponent(subject)}`,
				{
					method: 'GET',
				},
			)) as { edges: Record<string, unknown>[] }
			return raw.edges
		},
		async sparql(query) {
			const raw = (await request('/graph/sparql', {
				method: 'POST',
				body: JSON.stringify({ query }),
			})) as { results: unknown[][] }
			return raw.results
		},
	}
}
