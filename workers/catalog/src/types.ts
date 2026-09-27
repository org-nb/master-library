export type VideoStatus = 'draft' | 'ready' | 'published' | 'archived'
export type VideoVisibility = 'public' | 'private'
export type StorageBackend = 'r2' | 'stream' | 's3'
export type AssetKind = 'file' | 'package' | 'managed'
export type AssetState = 'pending' | 'processing' | 'ready' | 'failed' | 'missing' | 'deleting' | 'deleted'
export type PlaybackProtocol = 'mp4' | 'hls' | 'dash'

export interface VideoContributor {
	personId: string
	displayName: string
	role: string
}

export interface VideoTopic {
	topicId: string
	label: string
}

export interface PlaybackEntry {
	protocol: PlaybackProtocol
	entryPath: string
}

export interface VideoAsset {
	id: string
	locationId: string
	backend: StorageBackend
	externalId: string
	kind: AssetKind
	isSource: boolean
	state: AssetState
	playbackEnabled: boolean
	byteSize?: number
	sha256?: string
	errorCode?: string
	playbackEntries: PlaybackEntry[]
}

export interface VideoVersion {
	id: string
	versionNumber: number
	label: string
	language: string
	durationSeconds?: number
	preferredAssetId?: string
	assets: VideoAsset[]
}

export interface VideoRecord {
	id: string
	seriesId?: string
	seriesTitle?: string
	position?: number
	title: string
	description: string
	status: VideoStatus
	visibility: VideoVisibility
	language: string
	currentVersionId?: string
	contributors: VideoContributor[]
	topics: VideoTopic[]
	versions: VideoVersion[]
	updatedAt: string
}

export interface CatalogFilter {
	limit?: number
	offset?: number
	status?: VideoStatus | 'all'
	visibility?: VideoVisibility | 'all'
}

export interface CatalogRepository {
	listVideos(filter?: CatalogFilter): Promise<VideoRecord[]>
	getVideo(id: string): Promise<VideoRecord | null>
	searchVideos(query: string, limit?: number): Promise<VideoRecord[]>
}
