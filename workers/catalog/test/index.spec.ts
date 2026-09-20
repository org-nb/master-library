import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { catalogVideos, listCatalogVideos, searchCatalogVideos, type VideoRecord } from '../src/catalog'
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
})
