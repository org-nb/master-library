import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { catalogVideos, listCatalogVideos, searchCatalogVideos, type VideoRecord } from '../src/catalog'
import { summarizeCatalogVideos } from '../src/pipeline'
import worker from '../src/index'

const runtimeEnv = {
	...env,
	ASSETS: {
		fetch: async (request: Request) => new Response(`<!doctype html><title>Catalog</title>`, { status: 200, headers: { 'content-type': 'text/html' } }),
	},
	DB: undefined,
	CATALOG_STORAGE: undefined,
} as any

describe('master-library catalog worker', () => {
	it('returns the service health check', async () => {
		const request = new Request('https://example.com/api/health')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = await response.json()

		expect(response.status).toBe(200)
		expect(payload).toMatchObject({
			status: 'ok',
			service: 'master-library-catalog',
		})
	})

	it('returns only public published catalog results by default', () => {
		const hiddenVideo: VideoRecord = {
			id: 'hidden-001',
			title: 'Compassion in Private Practice',
			description: 'Private draft material that should never appear in the public catalog.',
			teacher: 'Hidden Teacher',
			topic: 'Compassion',
			status: 'published',
			visibility: 'private',
			language: 'en',
			stream_uid: 'hidden-stream',
			duration_seconds: 900,
			updated_at: '2026-09-20T00:00:00.000Z',
		}

		const videos = [...catalogVideos, hiddenVideo]
		const listResult = listCatalogVideos(videos)
		const searchResult = searchCatalogVideos(videos, 'compassion', 10)

		expect(listResult.some((video) => video.id === hiddenVideo.id)).toBe(false)
		expect(searchResult.some((video) => video.id === hiddenVideo.id)).toBe(false)
	})

	it('supports bounded pagination and direct lookup without exposing hidden records', () => {
		const videos = [
			...catalogVideos,
			{
				id: 'hidden-002',
				title: 'Private Draft Session',
				description: 'Not for public listing.',
				teacher: 'Hidden Teacher',
				topic: 'Practice',
				status: 'draft',
				visibility: 'private',
				language: 'en',
				stream_uid: 'hidden-002',
				duration_seconds: 600,
				updated_at: '2026-09-21T00:00:00.000Z',
			} as VideoRecord,
		]

		const page = listCatalogVideos(videos, { limit: 2, status: 'published', visibility: 'public', offset: 1 })
		expect(page).toHaveLength(2)
		expect(page[0].id).toBe('video-002')
		expect(page.every((video) => video.visibility === 'public')).toBe(true)
		expect(page.some((video) => video.id === 'hidden-002')).toBe(false)
		const direct = searchCatalogVideos(videos, 'compassion')
		expect(direct.some((video) => video.id === 'hidden-002')).toBe(false)
	})

	it('summarizes safe public catalog availability for sync jobs', () => {
		const summary = summarizeCatalogVideos([...catalogVideos, {
			id: 'hidden-003',
			title: 'Hidden Sync Job',
			description: 'Private content hidden from sync summaries.',
			teacher: 'Private Teacher',
			topic: 'Practice',
			status: 'ready',
			visibility: 'private',
			language: 'en',
			stream_uid: 'hidden-sync',
			duration_seconds: 600,
			updated_at: '2026-09-21T00:00:00.000Z',
		} as VideoRecord])

		expect(summary.visible).toBe(4)
		expect(summary.hidden).toBe(1)
		expect(summary.newestVideoId).toBe('video-001')
	})

	it('returns matching videos from the search endpoint', async () => {
		const request = new Request('https://example.com/api/search?q=compassion')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = await response.json()

		expect(response.status).toBe(200)
		expect(payload.count).toBeGreaterThan(0)
		expect(payload.items[0].title).toContain('Compassion')
	})

	it('exposes a catalog sync summary route', async () => {
		const request = new Request('https://example.com/api/sync-summary')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = await response.json()

		expect(response.status).toBe(200)
		expect(payload.visible).toBeGreaterThan(0)
		expect(payload.hidden).toBeGreaterThanOrEqual(0)
	})

	it('publishes a scheduled catalog sync summary for queue-style jobs', async () => {
		const response = await worker.scheduled({ cron: '0 * * * *' } as any, runtimeEnv)
		const payload = await response.json()

		expect(response.status).toBe(200)
		expect(payload.visible).toBe(3)
		expect(payload.hidden).toBe(1)
		expect(payload.count).toBe(3)
	})
})
