import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { migration0001, migration0002, migration0003 } from '../src/db/migrations'
import { runMigration } from '../src/db/runner'

describe('D1 migrations: 0001, 0002, 0003', () => {
	it('executes migrations and backfills legacy records correctly into BBC profile and asset tables', async () => {
		const db = env.DB as D1Database
		expect(db).toBeDefined()

		// Execute 0001
		await runMigration(db, migration0001)

		// Insert legacy seed data into videos
		await db
			.prepare(
				`INSERT INTO videos (id, stream_uid, title, description, teacher, topic, status, visibility, duration_seconds)
				 VALUES
				 ('legacy-001', 'uid-1001', 'Heart Sutra Intro', 'An introductory teaching.', 'Sister Yeshe', 'Prajnaparamita', 'published', 'public', 1200),
				 ('legacy-002', 'uid-1002', 'Private Session', 'Draft session.', 'Bhante Ananda', 'Meditation', 'draft', 'private', 800)
				`,
			)
			.run()

		// Execute 0002 (BBC profile tables) and 0003 (Backfill)
		await runMigration(db, migration0002)
		await runMigration(db, migration0003)

		// Verify video_versions backfill
		const versionsResult = await db.prepare('SELECT * FROM video_versions ORDER BY video_id').all()
		expect(versionsResult.results).toHaveLength(2)
		expect(versionsResult.results[0]).toMatchObject({
			id: 'ver-legacy-001-v1',
			video_id: 'legacy-001',
			version_number: 1,
			label: 'Original Release',
			duration_seconds: 1200,
			preferred_asset_id: 'asset-legacy-001-stream',
		})

		// Verify video_assets backfill
		const assetsResult = await db.prepare('SELECT * FROM video_assets ORDER BY id').all()
		expect(assetsResult.results).toHaveLength(2)
		const legacy1Asset = assetsResult.results.find((a) => a.id === 'asset-legacy-001-stream') as any
		expect(legacy1Asset).toBeDefined()
		expect(legacy1Asset.external_id).toBe('uid-1001')
		expect(legacy1Asset.kind).toBe('managed')
		expect(legacy1Asset.is_source).toBe(0)
		expect(legacy1Asset.playback_enabled).toBe(1)
		expect(legacy1Asset.state).toBe('ready')

		// Verify playback entries
		const entriesResult = await db
			.prepare('SELECT * FROM asset_playback_entries WHERE asset_id = ?')
			.bind('asset-legacy-001-stream')
			.all()
		expect(entriesResult.results).toHaveLength(1)
		expect(entriesResult.results[0]).toMatchObject({
			protocol: 'hls',
			entry_path: 'manifest/video.m3u8',
		})

		// Verify people and contributors
		const peopleResult = await db.prepare('SELECT * FROM people').all()
		expect(peopleResult.results.length).toBeGreaterThanOrEqual(2)
		const contributors = await db
			.prepare('SELECT * FROM video_contributors WHERE video_id = ?')
			.bind('legacy-001')
			.all()
		expect(contributors.results).toHaveLength(1)
		expect(contributors.results[0].role).toBe('teacher')

		// Verify topics
		const topicsResult = await db.prepare('SELECT * FROM topics').all()
		expect(topicsResult.results.length).toBeGreaterThanOrEqual(2)
		const videoTopics = await db.prepare('SELECT * FROM video_topics WHERE video_id = ?').bind('legacy-001').all()
		expect(videoTopics.results).toHaveLength(1)
	})
})
