import type { PlaybackProtocol, VideoAsset, VideoRecord, VideoVersion } from './types'

export interface PlaybackGrant {
	videoId: string
	versionId: string
	assetId: string
	backend: 'r2' | 'stream' | 's3'
	protocol: PlaybackProtocol
	url: string
	expiresAt: string
}

export interface PlaybackRequest {
	protocol?: PlaybackProtocol
	versionId?: string
	assetId?: string
}

export class PlaybackResolver {
	resolve(video: VideoRecord, request: PlaybackRequest = {}): PlaybackGrant {
		if (video.status !== 'published' || video.visibility !== 'public') {
			throw new Error('Video is not published or public')
		}

		const versionId = request.versionId ?? video.currentVersionId ?? video.versions[0]?.id
		const version = video.versions.find((v: VideoVersion) => v.id === versionId)
		if (!version) {
			throw new Error(`Requested version ${versionId} not found`)
		}

		const requestedProtocol: PlaybackProtocol = request.protocol || 'mp4'

		// Filter ready and playback_enabled assets
		const eligibleAssets = version.assets.filter(
			(a: VideoAsset) =>
				a.playbackEnabled && a.state === 'ready' && a.playbackEntries.some((e) => e.protocol === requestedProtocol),
		)

		if (eligibleAssets.length === 0) {
			throw new Error(`No eligible ${requestedProtocol} asset found for version ${version.id}`)
		}

		// Prioritize R2, then stream, then s3
		const priorityOrder = ['r2', 'stream', 's3']
		eligibleAssets.sort((a: VideoAsset, b: VideoAsset) => {
			if (a.id === version.preferredAssetId) return -1
			if (b.id === version.preferredAssetId) return 1
			return priorityOrder.indexOf(a.backend) - priorityOrder.indexOf(b.backend)
		})

		const selectedAsset = eligibleAssets[0]
		const entry = selectedAsset.playbackEntries.find((e) => e.protocol === requestedProtocol)
		if (!entry) {
			throw new Error(`No entry path found for protocol ${requestedProtocol}`)
		}

		// Construct media URL (e.g. for R2 MP4)
		const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
		let url = ''

		if (selectedAsset.backend === 'r2') {
			url = `/api/media/r2/${selectedAsset.id}?token=mock-grant`
		} else if (selectedAsset.backend === 'stream') {
			url = `https://customer.cloudflarestream.com/${selectedAsset.externalId}/${entry.entryPath}`
		} else {
			url = `https://cdn.masterlibrary.org/${selectedAsset.externalId}/${entry.entryPath}`
		}

		return {
			videoId: video.id,
			versionId: version.id,
			assetId: selectedAsset.id,
			backend: selectedAsset.backend,
			protocol: requestedProtocol,
			url,
			expiresAt,
		}
	}
}
