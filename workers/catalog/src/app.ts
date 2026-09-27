import { Hono } from 'hono'
import { D1CatalogRepository } from './db/repository'
import { fixtureVideos, InMemoryCatalogRepository } from './in-memory-catalog'
import { summarizeCatalogVideos } from './pipeline'
import { PlaybackResolver } from './playback'
import type { CatalogRepository, PlaybackProtocol } from './types'

export type Bindings = {
	ASSETS: Fetcher
	DB?: D1Database
	CATALOG_STORAGE?: R2Bucket
}

export function createCatalogApp(customRepo?: CatalogRepository) {
	const app = new Hono<{ Bindings: Bindings }>()
	const playbackResolver = new PlaybackResolver()

	function getRepo(c: { env: Bindings }): CatalogRepository {
		if (customRepo) return customRepo
		if (c.env.DB) return new D1CatalogRepository(c.env.DB)
		return new InMemoryCatalogRepository(fixtureVideos)
	}

	app.get('/api/health', (c) => {
		return c.json({
			status: 'ok',
			service: 'master-library-catalog',
			bindings: {
				d1: Boolean(c.env.DB),
				r2: Boolean(c.env.CATALOG_STORAGE),
			},
			timestamp: new Date().toISOString(),
		})
	})

	app.get('/api/videos', async (c) => {
		const repo = getRepo(c)
		if (!repo) {
			return c.json({ count: 0, offset: 0, items: [] })
		}

		const limit = Math.max(1, Math.min(Number.parseInt(c.req.query('limit') ?? '20', 10) || 20, 100))
		const offset = Math.max(0, Number.parseInt(c.req.query('offset') ?? '0', 10) || 0)
		const status = (c.req.query('status') as any) ?? undefined
		const visibility = (c.req.query('visibility') as any) ?? undefined

		const items = await repo.listVideos({ limit, offset, status, visibility })

		return c.json({
			count: items.length,
			offset,
			items,
		})
	})

	app.get('/api/videos/:id', async (c) => {
		const repo = getRepo(c)
		if (!repo) {
			return c.json({ error: 'Database binding unavailable' }, 503)
		}

		const id = c.req.param('id')
		const video = await repo.getVideo(id)

		if (video?.visibility !== 'public' || video.status !== 'published') {
			return c.json({ error: 'Video not found' }, 404)
		}

		return c.json(video)
	})

	app.get('/api/search', async (c) => {
		const repo = getRepo(c)
		if (!repo) {
			return c.json({ query: '', count: 0, items: [] })
		}

		const query = c.req.query('q') ?? ''
		const limit = Math.max(1, Math.min(Number.parseInt(c.req.query('limit') ?? '10', 10) || 10, 25))
		const results = await repo.searchVideos(query, limit)

		return c.json({
			query,
			count: results.length,
			items: results,
		})
	})

	app.post('/api/videos/:id/playback', async (c) => {
		const repo = getRepo(c)
		if (!repo) {
			return c.json({ error: 'Database binding unavailable' }, 503)
		}

		const id = c.req.param('id')
		const video = await repo.getVideo(id)
		if (video?.visibility !== 'public' || video.status !== 'published') {
			return c.json({ error: 'Video not found or not published' }, 404)
		}

		let body: { protocol?: PlaybackProtocol; versionId?: string } = {}
		try {
			body = await c.req.json()
		} catch {
			// fallback to query or defaults
		}

		const protocol = body.protocol ?? (c.req.query('protocol') as PlaybackProtocol) ?? 'mp4'
		const versionId = body.versionId ?? c.req.query('versionId') ?? undefined

		try {
			const grant = playbackResolver.resolve(video, { protocol, versionId })
			return c.json(grant)
		} catch (err: any) {
			return c.json({ error: err.message || 'Playback resolution failed' }, 400)
		}
	})

	app.get('/api/sync-summary', async (c) => {
		const repo = getRepo(c)
		if (!repo) {
			return c.json(summarizeCatalogVideos([] as any))
		}
		const allVideos = await repo.listVideos({ status: 'all', visibility: 'all', limit: 100 })
		return c.json(summarizeCatalogVideos(allVideos as any))
	})

	app.all('*', (c) => {
		return c.env.ASSETS.fetch(c.req.raw)
	})

	return app
}

const defaultApp = createCatalogApp()

export default {
	fetch: defaultApp.fetch,
	scheduled: async (_event: ScheduledEvent, env: Bindings): Promise<Response> => {
		const repo = env.DB ? new D1CatalogRepository(env.DB) : new InMemoryCatalogRepository(fixtureVideos)
		const rows = await repo.listVideos({ status: 'all', visibility: 'all', limit: 100 })
		const summary = summarizeCatalogVideos(rows as any)
		return new Response(JSON.stringify(summary), {
			headers: {
				'content-type': 'application/json',
			},
		})
	},
}
