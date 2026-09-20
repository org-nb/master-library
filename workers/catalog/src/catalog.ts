export type VideoStatus = 'draft' | 'ready' | 'published' | 'archived'
export type VideoVisibility = 'public' | 'private'

export type VideoRecord = {
	id: string
	title: string
	description: string
	teacher: string
	topic: string
	status: VideoStatus
	visibility: VideoVisibility
	language: string
	stream_uid: string
	duration_seconds: number
	updated_at: string
}

export const catalogVideos: VideoRecord[] = [
	{
		id: 'video-001',
		title: 'The Compassionate Heart',
		description: 'A guided teaching on cultivating compassion in daily practice and community life.',
		teacher: 'Sister Yeshe',
		topic: 'Compassion',
		status: 'published',
		visibility: 'public',
		language: 'en',
		stream_uid: 'stream-1001',
		duration_seconds: 1846,
		updated_at: '2026-09-20T10:15:00.000Z',
	},
	{
		id: 'video-002',
		title: 'Mindful Breathing for Stability',
		description: 'A practical session on breath awareness, attention, and calming the mind.',
		teacher: 'Bhante Ananda',
		topic: 'Breath',
		status: 'published',
		visibility: 'public',
		language: 'en',
		stream_uid: 'stream-1002',
		duration_seconds: 1450,
		updated_at: '2026-09-18T08:00:00.000Z',
	},
	{
		id: 'video-003',
		title: 'Voices of the Forest',
		description: 'A contemplative walking meditation rooted in the natural world and mindful awareness.',
		teacher: 'Maya K',
		topic: 'Meditation',
		status: 'draft',
		visibility: 'private',
		language: 'en',
		stream_uid: 'stream-1003',
		duration_seconds: 2342,
		updated_at: '2026-09-15T14:45:00.000Z',
	},
	{
		id: 'video-004',
		title: 'Resting in the Present',
		description: 'A gentle session on presence, taste, and the habits that support detachment.',
		teacher: 'Samanera Dhamma',
		topic: 'Presence',
		status: 'published',
		visibility: 'public',
		language: 'fr',
		stream_uid: 'stream-1004',
		duration_seconds: 1980,
		updated_at: '2026-09-12T12:10:00.000Z',
	},
]

export type CatalogFilter = {
	limit?: number
	status?: string
	visibility?: string
}

export function listCatalogVideos(
	videos: VideoRecord[] = catalogVideos,
	filter: CatalogFilter = {},
): VideoRecord[] {
	const limit = Math.max(1, Math.min(filter.limit ?? 20, 100))
	let results = videos.filter((video) => video.status === 'published' && video.visibility === 'public')

	if (filter.status) {
		results = results.filter((video) => video.status === filter.status)
	}

	if (filter.visibility) {
		results = results.filter((video) => video.visibility === filter.visibility)
	}

	return results.slice(0, limit)
}

export function findCatalogVideo(videos: VideoRecord[] = catalogVideos, id: string): VideoRecord | undefined {
	const allVideos = videos.filter((video) => video.status === 'published' && video.visibility === 'public')
	return allVideos.find((video) => video.id === id)
}

export function searchCatalogVideos(
	videos: VideoRecord[] = catalogVideos,
	query: string,
	limit = 10,
): VideoRecord[] {
	const normalized = query.trim().toLowerCase()
	if (!normalized) {
		return []
	}

	const matches = videos.filter((video) => {
		if (video.status !== 'published' || video.visibility !== 'public') {
			return false
		}
		const haystack = [video.title, video.description, video.teacher, video.topic]
			.join(' ')
			.toLowerCase()
		return haystack.includes(normalized)
	})

	return matches.slice(0, limit)
}
