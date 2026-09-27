import { describe, expect, it } from 'vitest'
import { PlaybackResolver } from '../src/playback'
import type { VideoRecord } from '../src/types'

describe('PlaybackResolver', () => {
	const resolver = new PlaybackResolver()

	const mockVideo: VideoRecord = {
		id: 'vid-test-01',
		title: 'Testing Compassion',
		description: 'A test talk.',
		status: 'published',
		visibility: 'public',
		language: 'en',
		currentVersionId: 'ver-01',
		contributors: [],
		topics: [],
		updatedAt: new Date().toISOString(),
		versions: [
			{
				id: 'ver-01',
				versionNumber: 1,
				label: 'Edition 1',
				language: 'en',
				durationSeconds: 1200,
				preferredAssetId: 'asset-r2',
				assets: [
					{
						id: 'asset-r2',
						locationId: 'loc-r2',
						backend: 'r2',
						externalId: 'videos/vid-test-01/v1/source.mp4',
						kind: 'file',
						isSource: true,
						state: 'ready',
						playbackEnabled: true,
						playbackEntries: [{ protocol: 'mp4', entryPath: '' }],
					},
					{
						id: 'asset-stream',
						locationId: 'loc-stream',
						backend: 'stream',
						externalId: 'stream-uid-1234',
						kind: 'managed',
						isSource: false,
						state: 'ready',
						playbackEnabled: true,
						playbackEntries: [{ protocol: 'hls', entryPath: 'manifest/video.m3u8' }],
					},
				],
			},
		],
	}

	it('resolves preferred R2 MP4 playback grant', () => {
		const grant = resolver.resolve(mockVideo, { protocol: 'mp4' })
		expect(grant.backend).toBe('r2')
		expect(grant.assetId).toBe('asset-r2')
		expect(grant.protocol).toBe('mp4')
		expect(grant.url).toContain('/api/media/r2/asset-r2')
	})

	it('resolves Stream HLS when HLS is requested', () => {
		const grant = resolver.resolve(mockVideo, { protocol: 'hls' })
		expect(grant.backend).toBe('stream')
		expect(grant.assetId).toBe('asset-stream')
		expect(grant.protocol).toBe('hls')
		expect(grant.url).toContain('cloudflarestream.com/stream-uid-1234/manifest/video.m3u8')
	})

	it('fails closed when video is private or draft', () => {
		const draftVideo = { ...mockVideo, status: 'draft' as const }
		expect(() => resolver.resolve(draftVideo)).toThrow('Video is not published or public')
	})

	it('fails closed when no ready/playback_enabled asset exists for requested protocol', () => {
		expect(() => resolver.resolve(mockVideo, { protocol: 'dash' })).toThrow(
			'No eligible dash asset found for version ver-01',
		)
	})
})
