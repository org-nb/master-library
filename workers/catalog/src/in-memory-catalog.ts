import type { CatalogFilter, CatalogRepository, VideoRecord } from './types'

export class InMemoryCatalogRepository implements CatalogRepository {
	constructor(private videos: VideoRecord[]) {}

	async listVideos(filter: CatalogFilter = {}): Promise<VideoRecord[]> {
		const limit = Math.max(1, Math.min(filter.limit ?? 20, 100))
		const offset = Math.max(0, filter.offset ?? 0)
		const status = filter.status ?? 'published'
		const visibility = filter.visibility ?? 'public'

		let results = this.videos

		if (status !== 'all') {
			results = results.filter((v) => v.status === status)
		}
		if (visibility !== 'all') {
			results = results.filter((v) => v.visibility === visibility)
		}

		return results.slice(offset, offset + limit)
	}

	async getVideo(id: string): Promise<VideoRecord | null> {
		return this.videos.find((v) => v.id === id) ?? null
	}

	async searchVideos(query: string, limit = 10): Promise<VideoRecord[]> {
		const norm = query.trim().toLowerCase()
		if (!norm) return []

		const matches = this.videos.filter((v) => {
			if (v.status !== 'published' || v.visibility !== 'public') return false
			const haystack = [
				v.title,
				v.description,
				...v.contributors.map((c) => c.displayName),
				...v.topics.map((t) => t.label),
			]
				.join(' ')
				.toLowerCase()
			return haystack.includes(norm)
		})

		return matches.slice(0, limit)
	}
}

export const fixtureVideos: VideoRecord[] = [
	{
		id: 'video-001',
		title: 'The Compassionate Heart',
		description: 'A guided teaching on cultivating compassion in daily practice and community life.',
		status: 'published',
		visibility: 'public',
		language: 'en',
		currentVersionId: 'ver-001-v1',
		contributors: [{ personId: 'p-1', displayName: 'Sister Yeshe', role: 'teacher' }],
		topics: [{ topicId: 't-1', label: 'Compassion' }],
		versions: [
			{
				id: 'ver-001-v1',
				versionNumber: 1,
				label: 'Original',
				language: 'en',
				durationSeconds: 1846,
				assets: [],
			},
		],
		updatedAt: '2026-09-20T10:15:00.000Z',
	},
	{
		id: 'video-002',
		title: 'Mindful Breathing for Stability',
		description: 'A practical session on breath awareness, attention, and calming the mind.',
		status: 'published',
		visibility: 'public',
		language: 'en',
		currentVersionId: 'ver-002-v1',
		contributors: [{ personId: 'p-2', displayName: 'Bhante Ananda', role: 'teacher' }],
		topics: [{ topicId: 't-2', label: 'Breath' }],
		versions: [
			{
				id: 'ver-002-v1',
				versionNumber: 1,
				label: 'Original',
				language: 'en',
				durationSeconds: 1450,
				assets: [],
			},
		],
		updatedAt: '2026-09-18T08:00:00.000Z',
	},
	{
		id: 'video-003',
		title: 'Voices of the Forest',
		description: 'A contemplative walking meditation rooted in the natural world and mindful awareness.',
		status: 'draft',
		visibility: 'private',
		language: 'en',
		currentVersionId: 'ver-003-v1',
		contributors: [{ personId: 'p-3', displayName: 'Maya K', role: 'teacher' }],
		topics: [{ topicId: 't-3', label: 'Meditation' }],
		versions: [
			{
				id: 'ver-003-v1',
				versionNumber: 1,
				label: 'Original',
				language: 'en',
				durationSeconds: 2342,
				assets: [],
			},
		],
		updatedAt: '2026-09-15T14:45:00.000Z',
	},
	{
		id: 'video-004',
		title: 'Resting in the Present',
		description: 'A gentle session on presence, taste, and the habits that support detachment.',
		status: 'published',
		visibility: 'public',
		language: 'fr',
		currentVersionId: 'ver-004-v1',
		contributors: [{ personId: 'p-4', displayName: 'Samanera Dhamma', role: 'teacher' }],
		topics: [{ topicId: 't-4', label: 'Presence' }],
		versions: [
			{
				id: 'ver-004-v1',
				versionNumber: 1,
				label: 'Original',
				language: 'fr',
				durationSeconds: 1980,
				assets: [],
			},
		],
		updatedAt: '2026-09-12T12:10:00.000Z',
	},
]
