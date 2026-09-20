/**
 * Cloudflare Worker for the Master Library catalog.
 *
 * ADR-0001 chooses a D1-backed editorial catalog with private R2 transcript files,
 * derived FTS5 and vector projections, and a Worker boundary that enforces visibility.
 */

import { Hono } from 'hono'
import {
	findCatalogVideo,
	listCatalogVideos,
	type VideoRecord,
	searchCatalogVideos,
} from './catalog'

type Bindings = {
	ASSETS: Fetcher
	DB?: D1Database
	CATALOG_STORAGE?: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

async function getVideoRows(env: Bindings): Promise<VideoRecord[]> {
	if (!env.DB) {
		return listCatalogVideos()
	}

	try {
		const { results } = await env.DB.prepare(
			`SELECT id, title, description, teacher, topic, status, visibility, language, stream_uid, duration_seconds, updated_at
			 FROM videos
			 WHERE visibility = 'public'
			 ORDER BY updated_at DESC
			 LIMIT 20`,
		).all()

		if (results.length === 0) {
			return listCatalogVideos()
		}

		return results as VideoRecord[]
	} catch {
		return listCatalogVideos()
	}
}

async function searchVideoRows(env: Bindings, query: string, limit: number): Promise<VideoRecord[]> {
	if (!env.DB) {
		return searchCatalogVideos(undefined, query, limit)
	}

	try {
		const likeQuery = `%${query.trim()}%`
		const { results } = await env.DB.prepare(
			`SELECT id, title, description, teacher, topic, status, visibility, language, stream_uid, duration_seconds, updated_at
			 FROM videos
			 WHERE visibility = 'public'
			 AND (title LIKE ?1 OR description LIKE ?1 OR teacher LIKE ?1 OR topic LIKE ?1)
			 ORDER BY updated_at DESC
			 LIMIT ?2`,
		).bind(likeQuery, limit).all()

		return results.length > 0 ? (results as VideoRecord[]) : searchCatalogVideos(undefined, query, limit)
	} catch {
		return searchCatalogVideos(undefined, query, limit)
	}
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
	const limit = Math.max(1, Math.min(Number.parseInt(c.req.query('limit') ?? '20', 10) || 20, 100))
	const visibility = c.req.query('visibility') ?? undefined
	const status = c.req.query('status') ?? undefined
	const rows = await getVideoRows(c.env)
	const filtered = listCatalogVideos(rows, { limit, status, visibility })

	return c.json({
		count: filtered.length,
		items: filtered,
	})
})

app.get('/api/videos/:id', async (c) => {
	const id = c.req.param('id')
	const rows = await getVideoRows(c.env)
	const video = findCatalogVideo(rows, id)

	if (!video) {
		return c.json({ error: 'Video not found' }, 404)
	}

	return c.json(video)
})

app.get('/api/search', async (c) => {
	const query = c.req.query('q') ?? ''
	const limit = Math.max(1, Math.min(Number.parseInt(c.req.query('limit') ?? '10', 10) || 10, 25))
	const results = await searchVideoRows(c.env, query, limit)

	return c.json({
		query,
		count: results.length,
		items: results,
	})
})

app.all('*', (c) => {
	return c.env.ASSETS.fetch(c.req.raw)
})

export default app
