import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import appModule from '../src/app'
import { migration0001, migration0002, migration0003 } from '../src/db/migrations'
import { runMigration } from '../src/db/runner'

describe('master-library catalog worker with D1 and BBC profile', () => {
	const db = env.DB as D1Database
	const runtimeEnv = {
		...env,
		ASSETS: {
			fetch: async (_request: Request) =>
				new Response(`<!doctype html><title>Catalog</title>`, {
					status: 200,
					headers: { 'content-type': 'text/html' },
				}),
		},
		DB: db,
		CATALOG_STORAGE: undefined,
	}

	beforeEach(async () => {
		// Clean and run migrations
		await db.exec('DROP TABLE IF EXISTS asset_playback_entries;')
		await db.exec('DROP TABLE IF EXISTS video_assets;')
		await db.exec('DROP TABLE IF EXISTS video_versions;')
		await db.exec('DROP TABLE IF EXISTS storage_locations;')
		await db.exec('DROP TABLE IF EXISTS video_topics;')
		await db.exec('DROP TABLE IF EXISTS topics;')
		await db.exec('DROP TABLE IF EXISTS video_contributors;')
		await db.exec('DROP TABLE IF EXISTS people;')
		await db.exec('DROP TABLE IF EXISTS series;')
		await db.exec('DROP TABLE IF EXISTS transcript_sources;')
		await db.exec('DROP TABLE IF EXISTS videos;')

		await runMigration(db, migration0001)

		await db
			.prepare(
				`INSERT INTO videos (id, stream_uid, title, description, teacher, topic, status, visibility, duration_seconds)
				 VALUES
				 ('vid-pub-01', 'uid-1', 'The Compassionate Heart', 'Guided compassion teaching.', 'Sister Yeshe', 'Compassion', 'published', 'public', 1846),
				 ('vid-draft-02', 'uid-2', 'Private Session', 'Draft session.', 'Bhante Ananda', 'Meditation', 'draft', 'private', 800)
				`,
			)
			.run()

		await runMigration(db, migration0002)
		await runMigration(db, migration0003)

		// Also add a ready R2 MP4 asset for vid-pub-01 version 1
		await db
			.prepare(
				`INSERT INTO storage_locations (id, backend, environment, account_id, bucket_name, region, enabled)
				 VALUES ('loc-r2-dev', 'r2', 'dev', 'cf-account-dev-123', 'master-library-catalog-dev', NULL, 1)
				`,
			)
			.run()

		await db
			.prepare(
				`INSERT INTO video_assets (id, video_version_id, location_id, external_id, kind, is_source, state, playback_enabled)
				 VALUES ('asset-pub-01-r2', 'ver-vid-pub-01-v1', 'loc-r2-dev', 'videos/vid-pub-01/v1/source.mp4', 'file', 1, 'ready', 1)
				`,
			)
			.run()

		await db
			.prepare(
				`INSERT INTO asset_playback_entries (id, asset_id, protocol, entry_path)
				 VALUES ('entry-pub-01-r2-mp4', 'asset-pub-01-r2', 'mp4', '')
				`,
			)
			.run()

		// Set preferred asset on version to R2
		await db
			.prepare(`UPDATE video_versions SET preferred_asset_id = 'asset-pub-01-r2' WHERE id = 'ver-vid-pub-01-v1'`)
			.run()
	})

	it('returns service health check', async () => {
		const request = new Request('https://example.com/api/health')
		const ctx = createExecutionContext()
		const response = await appModule.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = (await response.json()) as any

		expect(response.status).toBe(200)
		expect(payload).toMatchObject({
			status: 'ok',
			service: 'master-library-catalog',
			bindings: {
				d1: true,
			},
		})
	})

	it('lists public published videos and hides private drafts', async () => {
		const request = new Request('https://example.com/api/videos')
		const ctx = createExecutionContext()
		const response = await appModule.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = (await response.json()) as any

		expect(response.status).toBe(200)
		expect(payload.count).toBe(1)
		expect(payload.items[0].id).toBe('vid-pub-01')
		expect(payload.items[0].contributors[0].displayName).toBe('Sister Yeshe')
		expect(payload.items[0].topics[0].label).toBe('Compassion')
		expect(payload.items[0].versions[0].assets.length).toBeGreaterThanOrEqual(2)
	})

	it('retrieves single video by id and fails 404 for private draft', async () => {
		const req1 = new Request('https://example.com/api/videos/vid-pub-01')
		const ctx1 = createExecutionContext()
		const res1 = await appModule.fetch(req1, runtimeEnv, ctx1)
		await waitOnExecutionContext(ctx1)
		expect(res1.status).toBe(200)

		const req2 = new Request('https://example.com/api/videos/vid-draft-02')
		const ctx2 = createExecutionContext()
		const res2 = await appModule.fetch(req2, runtimeEnv, ctx2)
		await waitOnExecutionContext(ctx2)
		expect(res2.status).toBe(404)
	})

	it('searches videos via D1 joins on contributors and topics', async () => {
		const request = new Request('https://example.com/api/search?q=Yeshe')
		const ctx = createExecutionContext()
		const response = await appModule.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = (await response.json()) as any

		expect(response.status).toBe(200)
		expect(payload.count).toBe(1)
		expect(payload.items[0].id).toBe('vid-pub-01')
	})

	it('resolves playback grant prioritising R2 MP4', async () => {
		const request = new Request('https://example.com/api/videos/vid-pub-01/playback', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ protocol: 'mp4' }),
		})
		const ctx = createExecutionContext()
		const response = await appModule.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = (await response.json()) as any

		expect(response.status).toBe(200)
		expect(payload.backend).toBe('r2')
		expect(payload.assetId).toBe('asset-pub-01-r2')
		expect(payload.protocol).toBe('mp4')
		expect(payload.url).toContain('/api/media/r2/asset-pub-01-r2')
	})

	it('resolves Stream HLS playback grant when requested', async () => {
		const request = new Request('https://example.com/api/videos/vid-pub-01/playback', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ protocol: 'hls' }),
		})
		const ctx = createExecutionContext()
		const response = await appModule.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)
		const payload = (await response.json()) as any

		expect(response.status).toBe(200)
		expect(payload.backend).toBe('stream')
		expect(payload.protocol).toBe('hls')
		expect(payload.url).toContain('manifest/video.m3u8')
	})

	it('fails closed on playback for private or non-existent video', async () => {
		const request = new Request('https://example.com/api/videos/vid-draft-02/playback', {
			method: 'POST',
		})
		const ctx = createExecutionContext()
		const response = await appModule.fetch(request, runtimeEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(404)
	})
})
