import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
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
