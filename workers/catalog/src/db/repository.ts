import type { CatalogFilter, CatalogRepository, PlaybackProtocol, VideoRecord } from '../types'

interface VideoRow {
	id: string
	series_id: string | null
	position: number | null
	title: string
	description: string | null
	language: string
	status: string
	visibility: string
	current_version_id: string | null
	duration_seconds: number
	updated_at: string
}

interface ContributorRow {
	video_id: string
	person_id: string
	display_name: string
	role: string
}

interface TopicRow {
	video_id: string
	topic_id: string
	label: string
}

interface VersionRow {
	id: string
	video_id: string
	version_number: number
	label: string
	language: string
	duration_seconds: number | null
	preferred_asset_id: string | null
}

interface AssetRow {
	id: string
	video_version_id: string
	location_id: string
	backend: string
	external_id: string
	kind: string
	is_source: number
	state: string
	playback_enabled: number
	byte_size: number | null
	sha256: string | null
	error_code: string | null
}

interface PlaybackEntryRow {
	asset_id: string
	protocol: string
	entry_path: string
}

export class D1CatalogRepository implements CatalogRepository {
	constructor(private db: D1Database) {}

	private async enrichVideos(videoRows: VideoRow[]): Promise<VideoRecord[]> {
		if (videoRows.length === 0) {
			return []
		}

		const videoIds = videoRows.map((v) => v.id)
		const placeholders = videoIds.map(() => '?').join(',')

		// Fetch contributors
		const contributorsResult = await this.db
			.prepare(
				`SELECT c.video_id, c.person_id, p.display_name, c.role
				 FROM video_contributors c
				 JOIN people p ON p.id = c.person_id
				 WHERE c.video_id IN (${placeholders})`,
			)
			.bind(...videoIds)
			.all<ContributorRow>()

		// Fetch topics
		const topicsResult = await this.db
			.prepare(
				`SELECT vt.video_id, vt.topic_id, t.label
				 FROM video_topics vt
				 JOIN topics t ON t.id = vt.topic_id
				 WHERE vt.video_id IN (${placeholders})`,
			)
			.bind(...videoIds)
			.all<TopicRow>()

		// Fetch versions
		const versionsResult = await this.db
			.prepare(
				`SELECT id, video_id, version_number, label, language, duration_seconds, preferred_asset_id
				 FROM video_versions
				 WHERE video_id IN (${placeholders}) AND deleted_at IS NULL
				 ORDER BY version_number ASC`,
			)
			.bind(...videoIds)
			.all<VersionRow>()

		const versionIds = versionsResult.results.map((v) => v.id)
		let assetsResult: { results: AssetRow[] } = { results: [] }
		let entriesResult: { results: PlaybackEntryRow[] } = { results: [] }

		if (versionIds.length > 0) {
			const versionPlaceholders = versionIds.map(() => '?').join(',')
			assetsResult = await this.db
				.prepare(
					`SELECT a.id, a.video_version_id, a.location_id, l.backend, a.external_id, a.kind, a.is_source, a.state, a.playback_enabled, a.byte_size, a.sha256, a.error_code
					 FROM video_assets a
					 JOIN storage_locations l ON l.id = a.location_id
					 WHERE a.video_version_id IN (${versionPlaceholders}) AND a.deleted_at IS NULL`,
				)
				.bind(...versionIds)
				.all<AssetRow>()

			const assetIds = assetsResult.results.map((a) => a.id)
			if (assetIds.length > 0) {
				const assetPlaceholders = assetIds.map(() => '?').join(',')
				entriesResult = await this.db
					.prepare(
						`SELECT asset_id, protocol, entry_path
						 FROM asset_playback_entries
						 WHERE asset_id IN (${assetPlaceholders})`,
					)
					.bind(...assetIds)
					.all<PlaybackEntryRow>()
			}
		}

		return videoRows.map((v) => {
			const contributors = contributorsResult.results
				.filter((c) => c.video_id === v.id)
				.map((c) => ({
					personId: c.person_id,
					displayName: c.display_name,
					role: c.role,
				}))

			const topics = topicsResult.results
				.filter((t) => t.video_id === v.id)
				.map((t) => ({
					topicId: t.topic_id,
					label: t.label,
				}))

			const versions = versionsResult.results
				.filter((ver) => ver.video_id === v.id)
				.map((ver) => {
					const assets = assetsResult.results
						.filter((a) => a.video_version_id === ver.id)
						.map((a) => {
							const playbackEntries = entriesResult.results
								.filter((e) => e.asset_id === a.id)
								.map((e) => ({
									protocol: e.protocol as PlaybackProtocol,
									entryPath: e.entry_path,
								}))

							return {
								id: a.id,
								locationId: a.location_id,
								backend: a.backend as 'r2' | 'stream' | 's3',
								externalId: a.external_id,
								kind: a.kind as 'file' | 'package' | 'managed',
								isSource: Boolean(a.is_source),
								state: a.state as any,
								playbackEnabled: Boolean(a.playback_enabled),
								byteSize: a.byte_size ?? undefined,
								sha256: a.sha256 ?? undefined,
								errorCode: a.error_code ?? undefined,
								playbackEntries,
							}
						})

					return {
						id: ver.id,
						versionNumber: ver.version_number,
						label: ver.label,
						language: ver.language,
						durationSeconds: ver.duration_seconds ?? undefined,
						preferredAssetId: ver.preferred_asset_id ?? undefined,
						assets,
					}
				})

			return {
				id: v.id,
				seriesId: v.series_id ?? undefined,
				position: v.position ?? undefined,
				title: v.title,
				description: v.description ?? '',
				status: v.status as any,
				visibility: v.visibility as any,
				language: v.language,
				currentVersionId: v.current_version_id ?? versions[0]?.id,
				contributors,
				topics,
				versions,
				updatedAt: v.updated_at,
			}
		})
	}

	async listVideos(filter: CatalogFilter = {}): Promise<VideoRecord[]> {
		const limit = Math.max(1, Math.min(filter.limit ?? 20, 100))
		const offset = Math.max(0, filter.offset ?? 0)
		const status = filter.status ?? 'published'
		const visibility = filter.visibility ?? 'public'

		let query = `SELECT id, series_id, position, title, description, language, status, visibility, current_version_id, duration_seconds, updated_at
		             FROM videos WHERE 1=1`
		const params: (string | number)[] = []

		if (status !== 'all') {
			query += ' AND status = ?'
			params.push(status)
		}
		if (visibility !== 'all') {
			query += ' AND visibility = ?'
			params.push(visibility)
		}

		query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
		params.push(limit, offset)

		const { results } = await this.db
			.prepare(query)
			.bind(...params)
			.all<VideoRow>()
		return this.enrichVideos(results)
	}

	async getVideo(id: string): Promise<VideoRecord | null> {
		const { results } = await this.db
			.prepare(
				`SELECT id, series_id, position, title, description, language, status, visibility, current_version_id, duration_seconds, updated_at
				 FROM videos
				 WHERE id = ?`,
			)
			.bind(id)
			.all<VideoRow>()

		if (results.length === 0) {
			return null
		}

		const enriched = await this.enrichVideos(results)
		return enriched[0] ?? null
	}

	async searchVideos(query: string, limit = 10): Promise<VideoRecord[]> {
		const cleanQuery = query.trim()
		if (!cleanQuery) {
			return []
		}

		const pattern = `%${cleanQuery}%`
		const boundLimit = Math.max(1, Math.min(limit, 50))

		const { results } = await this.db
			.prepare(
				`SELECT DISTINCT v.id, v.series_id, v.position, v.title, v.description, v.language, v.status, v.visibility, v.current_version_id, v.duration_seconds, v.updated_at
				 FROM videos v
				 LEFT JOIN video_contributors vc ON vc.video_id = v.id
				 LEFT JOIN people p ON p.id = vc.person_id
				 LEFT JOIN video_topics vt ON vt.video_id = v.id
				 LEFT JOIN topics t ON t.id = vt.topic_id
				 WHERE v.status = 'published' AND v.visibility = 'public'
				   AND (v.title LIKE ?1 OR v.description LIKE ?1 OR p.display_name LIKE ?1 OR t.label LIKE ?1)
				 ORDER BY v.updated_at DESC
				 LIMIT ?2`,
			)
			.bind(pattern, boundLimit)
			.all<VideoRow>()

		return this.enrichVideos(results)
	}
}
