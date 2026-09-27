import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { D1CatalogRepository } from '../src/db/repository'

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
		await db.exec('DROP TABLE IF EXISTS d1_migrations;')

		await applyD1Migrations(db, env.TEST_MIGRATIONS.slice(0, 1))

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

		await applyD1Migrations(db, env.TEST_MIGRATIONS)

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

	it.each([
		{ currentVersionId: 'ver-vid-001-v2', expected: 'ver-vid-001-v2' },
		{ currentVersionId: null, expected: 'ver-vid-001-v1' },
		{ currentVersionId: 'missing-version', expected: 'missing-version' },
	])('uses current version $currentVersionId consistently across queries', async ({ currentVersionId, expected }) => {
		await db
			.prepare(
				`INSERT INTO video_versions (id, video_id, version_number, label)
				 VALUES ('ver-vid-001-v2', 'vid-001', 2, 'Re-edited')`,
			)
			.run()
		await db.prepare('UPDATE videos SET current_version_id = ? WHERE id = ?').bind(currentVersionId, 'vid-001').run()

		const video = await repo.getVideo('vid-001')
		const listed = (await repo.listVideos()).find((item) => item.id === 'vid-001')
		const searched = (await repo.searchVideos('Bodhisattva'))[0]

		expect(video?.currentVersionId).toBe(expected)
		expect(listed?.currentVersionId).toBe(expected)
		expect(searched?.currentVersionId).toBe(expected)
		expect(video?.versions.map((version) => version.versionNumber)).toEqual([1, 2])
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
