import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { migration0001, migration0002, migration0003 } from '../src/db/migrations'
import { D1CatalogRepository } from '../src/db/repository'
import { runMigration } from '../src/db/runner'

describe('D1CatalogRepository', () => {
	let repo: D1CatalogRepository
	const db = env.DB as D1Database

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
				 ('vid-001', 'uid-1', 'The Bodhisattva Path', 'Talk on Bodhisattva aspirations.', 'Sister Yeshe', 'Compassion', 'published', 'public', 1800),
				 ('vid-002', 'uid-2', 'Meditation Fundamentals', 'Introductory breath practice.', 'Bhante Ananda', 'Meditation', 'published', 'public', 1200),
				 ('vid-003', 'uid-3', 'Internal Working Draft', 'Private working copy.', 'Sister Yeshe', 'Staff', 'draft', 'private', 600)
				`,
			)
			.run()

		await runMigration(db, migration0002)
		await runMigration(db, migration0003)

		repo = new D1CatalogRepository(db)
	})

	it('lists public published videos with enriched BBC entities and asset locations', async () => {
		const videos = await repo.listVideos()
		expect(videos).toHaveLength(2)

		const v1 = videos.find((v) => v.id === 'vid-001')
		expect(v1).toBeDefined()
		expect(v1?.contributors).toHaveLength(1)
		expect(v1?.contributors[0].displayName).toBe('Sister Yeshe')
		expect(v1?.contributors[0].role).toBe('teacher')
		expect(v1?.topics).toHaveLength(1)
		expect(v1?.topics[0].label).toBe('Compassion')
		expect(v1?.versions).toHaveLength(1)
		expect(v1?.versions[0].assets).toHaveLength(1)
		expect(v1?.versions[0].assets[0].playbackEntries[0].protocol).toBe('hls')
	})

	it('returns null when getting a non-existent video', async () => {
		const video = await repo.getVideo('does-not-exist')
		expect(video).toBeNull()
	})

	it('searches videos across title, description, contributors and topics', async () => {
		const byTeacher = await repo.searchVideos('Sister Yeshe')
		expect(byTeacher).toHaveLength(1)
		expect(byTeacher[0].id).toBe('vid-001')

		const byTopic = await repo.searchVideos('Meditation')
		expect(byTopic).toHaveLength(1)
		expect(byTopic[0].id).toBe('vid-002')

		const empty = await repo.searchVideos('NonExistent')
		expect(empty).toHaveLength(0)
	})
})
