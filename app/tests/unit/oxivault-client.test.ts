import { describe, expect, it } from 'vitest'
import { AppError, ConflictError, NotFoundError } from '../../src/lib/errors.js'
import { createOxivaultClient } from '../../src/lib/oxivault/client.js'

function fakeFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input)
		return handler(url, init)
	}) as typeof fetch
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
	return new Headers(init?.headers).get(name)
}

const noteBody = {
	path: 'videos/a.md',
	etag: '"e1"',
	frontmatter: { title: 'A' },
	body: 'body',
}

describe('oxivault client', () => {
	it('sends the bearer token and parses notes', async () => {
		let auth = ''
		const client = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch((_url, init) => {
				auth = headerOf(init, 'authorization') ?? ''
				return Response.json(noteBody)
			}),
		})
		const note = await client.getNote('videos/a.md')
		expect(auth).toBe('Bearer tok')
		expect(note.frontmatter).toEqual({ title: 'A' })
	})

	it('maps 404 to NotFoundError and 409 to ConflictError', async () => {
		const client = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch(() => new Response('nope', { status: 404 })),
		})
		await expect(client.getNote('x')).rejects.toThrowError(NotFoundError)
		const conflictClient = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch(() => new Response('conflict', { status: 409 })),
		})
		await expect(conflictClient.putNote('x', {}, '')).rejects.toThrowError(
			ConflictError,
		)
	})

	it('propagates If-Match and If-None-Match headers', async () => {
		const seen: Record<string, string>[] = []
		const client = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch((_url, init) => {
				seen.push(Object.fromEntries(Object.entries(init?.headers ?? {})))
				return Response.json(noteBody)
			}),
		})
		await client.putNote('videos/a.md', { title: 'A2' }, 'b', {
			ifMatch: '"e1"',
		})
		await client.putNote('videos/b.md', { title: 'B' }, '', {
			ifNoneMatchStar: true,
		})
		expect(seen[0]['if-match']).toBe('"e1"')
		expect(seen[1]['if-none-match']).toBe('*')
		expect(seen[1]['if-match']).toBeUndefined()
	})

	it('maps 400 with the oxivault detail message', async () => {
		const client = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch(() =>
				Response.json({ detail: 'bad key' }, { status: 400 }),
			),
		})
		await expect(client.getNote('/abs')).rejects.toThrowError(/bad key/)
	})

	it('maps 5xx and network failures to 502 AppErrors', async () => {
		const bad = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch(() => Response.json({}, { status: 500 })),
		})
		await expect(bad.vaultInfo()).rejects.toThrowError(AppError)
		const offline = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch(() => {
				throw new TypeError('fetch failed')
			}),
		})
		const err = await offline.vaultInfo().catch((e) => e)
		expect(err).toBeInstanceOf(AppError)
		expect((err as AppError).status).toBe(502)
	})

	it('parses search and vault info payloads', async () => {
		const client = createOxivaultClient({
			baseUrl: 'http://vault.test',
			token: 'tok',
			fetchImpl: fakeFetch((url) => {
				if (url.endsWith('/vault'))
					return Response.json({ note_count: 3, triple_count: 42 })
				return Response.json({
					triples: [{ s: 'x' }],
					body_notes: ['videos/a.md'],
				})
			}),
		})
		expect(await client.vaultInfo()).toEqual({ noteCount: 3, tripleCount: 42 })
		expect(await client.search('bodhi')).toEqual({
			triples: [{ s: 'x' }],
			bodyNotes: ['videos/a.md'],
		})
	})
})
