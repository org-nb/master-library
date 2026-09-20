import { catalogVideos, type VideoRecord } from './catalog'

export type CatalogSyncSummary = {
	visible: number
	hidden: number
	count: number
	newestVideoId?: string
	newestUpdatedAt?: string
}

export function isVisibleCatalogVideo(video: VideoRecord): boolean {
	return video.status !== 'draft' && video.status !== 'archived'
}

export function summarizeCatalogVideos(videos: VideoRecord[] = catalogVideos): CatalogSyncSummary {
	const visible = videos.filter(isVisibleCatalogVideo)
	const hidden = videos.length - visible.length
	const newest = [...videos]
		.filter((video) => video.status === 'published' && video.visibility === 'public')
		.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]

	return {
		visible: visible.length,
		hidden,
		count: visible.length,
		newestVideoId: newest?.id,
		newestUpdatedAt: newest?.updated_at,
	}
}
