import { type ChildProcess, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '../../src/lib/errors.js'
import { createOxivaultClient } from '../../src/lib/oxivault/client.js'

const PORT = 8123
const BASE = `http://127.0.0.1:${PORT}`
const FIXTURES_VAULT = resolve(__dirname, '../../fixtures/vault')

let server: ChildProcess
let workDir: string
let client: ReturnType<typeof createOxivaultClient>

async function waitForPort(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		try {
			const res = await fetch(url)
			if (res.ok) return
		} catch {
			// not up yet
		}
		if (Date.now() > deadline)
			throw new Error(`oxivault did not start at ${url}`)
		await new Promise((r) => setTimeout(r, 250))
	}
}

beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), 'oxivault-'))
	const vaultDir = join(workDir, 'vault')
	await mkdir(vaultDir, { recursive: true })
	await cp(FIXTURES_VAULT, vaultDir, { recursive: true })
	server = spawn(
		'uvx',
		[
			'--from',
			'oxivault==0.2.1',
			'oxivault',
			'serve',
			vaultDir,
			'--host',
			'127.0.0.1',
			'--port',
			String(PORT),
		],
		{ stdio: 'ignore' },
	)
	await waitForPort(`${BASE}/vault`, 60_000)
	client = createOxivaultClient({ baseUrl: BASE, token: '' })
}, 90_000)

afterAll(async () => {
	server?.kill()
	if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('real oxivault 0.2.1 (PyPI wheel)', () => {
	it('lists the fixture notes', async () => {
		const notes = await client.listNotes('videos/')
		expect(notes.length).toBeGreaterThanOrEqual(3)
		expect(notes.map((n) => n.path)).toContain('videos/bodhicitta-part-1.md')
	})

	it('reads a note with frontmatter and etag', async () => {
		const note = await client.getNote('videos/bodhicitta-part-1.md')
		expect(note.frontmatter.title).toBe('Bodhicitta Part 1')
		expect(note.etag).toBeTruthy()
	})

	it('returns 404 for missing notes', async () => {
		await expect(client.getNote('videos/missing.md')).rejects.toThrowError(
			NotFoundError,
		)
	})

	it('updates a note conditionally and enforces If-Match', async () => {
		const note = await client.getNote('videos/mahamudra-opening.md')
		await client.putNote(
			'videos/mahamudra-opening.md',
			{ ...note.frontmatter, description: 'updated' },
			note.body,
			{
				ifMatch: note.etag,
			},
		)
		await expect(
			client.putNote(
				'videos/mahamudra-opening.md',
				{ ...note.frontmatter },
				note.body,
				{ ifMatch: note.etag },
			),
		).rejects.toThrowError(ConflictError)
		const after = await client.getNote('videos/mahamudra-opening.md')
		expect(after.frontmatter.description).toBe('updated')
		expect(after.etag).not.toBe(note.etag)
	})

	it('creates a note only-if-absent and rejects duplicates', async () => {
		const fm = {
			type: 'VideoEpisode',
			title: 'Integration Probe',
			content_tier: 'recording',
			year: 2026,
			place_iri: 'http://sws.geonames.org/1252634',
			place_slug: 'bodhgaya',
			event_id: 'evt_2026_winter',
			event_slug: 'winter-retreat-2026',
			episode_id: 'ep_probe0001',
			episode_slug: 'integration-probe',
		}
		await client.putNote('videos/integration-probe.md', fm, '', {
			ifNoneMatchStar: true,
		})
		await expect(
			client.putNote('videos/integration-probe.md', fm, '', {
				ifNoneMatchStar: true,
			}),
		).rejects.toThrowError(ConflictError)
	})

	it('searches note bodies', async () => {
		const result = await client.search('mahamudra')
		expect(result.bodyNotes).toContain('videos/mahamudra-opening.md')
	})

	it('reports vault info', async () => {
		const info = await client.vaultInfo()
		expect(info.noteCount).toBeGreaterThanOrEqual(3)
	})
})
