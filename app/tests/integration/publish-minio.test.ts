import { type ChildProcess, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/lib/env/config.js'
import { NotFoundError, ValidationError } from '../../src/lib/errors.js'
import { createOxivaultClient } from '../../src/lib/oxivault/client.js'
import {
	type PublishDeps,
	publishVideo,
	unpublishVideo,
} from '../../src/lib/publish/pointer.js'
import { createS3Ops, type S3Ops } from '../../src/lib/s3.js'

// Full-stack integration (ADR-0004 plan, A7): real oxivault 0.2.1 + real
// S3 (MinIO as the R2 stand-in). Skips when MINIO_URL is unreachable,
// e.g. on a laptop without the compose service; CI runs it with Docker.
const MINIO_URL = process.env.MINIO_URL ?? 'http://localhost:9000'
const MINIO_USER = process.env.MINIO_USER ?? 'testuser'
const MINIO_PASS = process.env.MINIO_PASS ?? 'testpassword'
const OX_PORT = 8124
const BASE = `http://127.0.0.1:${OX_PORT}`
const PRIVATE_BUCKET = 'master-library-media-private-dev'
const PUBLIC_BUCKET = 'master-library-media-public-dev'
const KEY =
	'2026/bodhgaya/recordings/evt_2026_winter--winter-retreat-2026/ep_abcd1234--bodhicitta-part-1/v1/playback.mp4'
const POINTER = KEY.replace('playback.mp4', 'published.pointer.json')
const PATH = 'videos/bodhicitta-part-1.md'

/**
 * Synchronous TCP reachability probe. Module scope needs a plain boolean
 * before `describe.runIf` runs, and vitest 3.2 hooks cannot skip a suite
 * asynchronously.
 */
function minioReachableSync(): boolean {
	const url = new URL(MINIO_URL)
	const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
	const sock = new net.Socket()
	const cell = new Int32Array(new SharedArrayBuffer(4))
	const settle = (ok: boolean) => {
		Atomics.store(cell, 0, ok ? 1 : 0)
		Atomics.notify(cell, 0)
	}
	sock.setTimeout(2000)
	sock.once('connect', () => {
		settle(true)
		sock.destroy()
	})
	sock.once('error', () => settle(false))
	sock.once('timeout', () => {
		settle(false)
		sock.destroy()
	})
	sock.connect(port, url.hostname)
	Atomics.wait(cell, 0, 0, 3000)
	return Atomics.load(cell, 0) === 1
}

const minioUp = minioReachableSync()

if (!minioUp)
	console.warn(`skipping MinIO round-trip: ${MINIO_URL} is not reachable`)

describe.runIf(minioUp)(
	'publish/unpublish against MinIO + real oxivault',
	() => {
		let server: ChildProcess
		let workDir: string
		let s3: S3Ops
		let notes: ReturnType<typeof createOxivaultClient>
		let deps: PublishDeps

		beforeAll(async () => {
			workDir = await mkdtemp(join(tmpdir(), 'ml-int-'))
			const vaultDir = join(workDir, 'vault')
			await mkdir(vaultDir, { recursive: true })
			await cp(resolve(__dirname, '../../fixtures/vault'), vaultDir, {
				recursive: true,
			})
			server = spawn(
				'uvx',
				[
					'--from',
					'oxivault==0.2.1',
					'oxivault',
					'serve',
					vaultDir,
					'--host',
					'127.0.0.1',
					'--port',
					String(OX_PORT),
				],
				{ stdio: 'ignore' },
			)
			const deadline = Date.now() + 60_000
			for (;;) {
				try {
					if ((await fetch(`${BASE}/vault`)).ok) break
				} catch {
					// not up yet
				}
				if (Date.now() > deadline) throw new Error('oxivault did not start')
				await new Promise((r) => setTimeout(r, 250))
			}
			notes = createOxivaultClient({ baseUrl: BASE, token: '' })

			const cfg = loadConfig({
				...process.env,
				APP_ORIGIN: 'http://localhost:5173',
				PUBLIC_MEDIA_BASE_URL: 'http://media.test',
				S3_ENDPOINT_URL: MINIO_URL,
				S3_ACCESS_KEY_ID: MINIO_USER,
				S3_SECRET_ACCESS_KEY: MINIO_PASS,
				R2_BUCKET_PRIVATE: PRIVATE_BUCKET,
				R2_BUCKET_PUBLIC: PUBLIC_BUCKET,
				OXIVAULT_EDITOR_TOKEN: 'x',
				GOOGLE_CLIENT_ID: 'x',
				GOOGLE_CLIENT_SECRET: 'x',
				SESSION_SECRET: '01234567890123456789012345678901',
				OAUTH_USER_COUNT: '0',
			} as Record<string, string>)
			s3 = createS3Ops(cfg)
			// Bucket creation is not exposed by the installed SDK build
			// (no PutBucketCommand); the CI workflow and local runbook create
			// them. Fail with a clear message if they are missing.
			const admin = new S3Client({
				endpoint: MINIO_URL,
				region: 'us-east-1',
				credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASS },
				forcePathStyle: true,
			})
			for (const bucket of [PRIVATE_BUCKET, PUBLIC_BUCKET]) {
				const head = await admin.send(new HeadBucketCommand({ Bucket: bucket }))
				if (head.$metadata.httpStatusCode === 404) {
					throw new Error(
						`bucket ${bucket} missing; create it first (see tests/runbook note)`,
					)
				}
			}
			// Seed the master object.
			await s3.putObject(PRIVATE_BUCKET, KEY, 'MASTER-BYTES-FOR-INTEGRATION')
			deps = {
				notes,
				s3,
				privateBucket: PRIVATE_BUCKET,
				publicBucket: PUBLIC_BUCKET,
				publicBaseUrl: 'http://media.test',
			}
		}, 120_000)

		afterAll(async () => {
			server?.kill()
			if (workDir) await rm(workDir, { recursive: true, force: true })
		})

		it('publishes: public object, pointer, and frontmatter agree', async () => {
			const pointer = await publishVideo(deps, 'bodhicitta-part-1')
			expect(pointer.target_bucket).toBe(PUBLIC_BUCKET)
			const target = await s3.headObject(PUBLIC_BUCKET, KEY)
			expect(target.size).toBe('MASTER-BYTES-FOR-INTEGRATION'.length)
			const note = await notes.getNote(PATH)
			expect(note.frontmatter.publication_state).toBe('published')
			expect(note.frontmatter.public_object_key).toBe(KEY)
			expect(note.frontmatter.pointer_key).toBe(POINTER)
		})

		it('is idempotent on republish', async () => {
			const pointer = await publishVideo(deps, 'bodhicitta-part-1')
			const target = await s3.headObject(PUBLIC_BUCKET, KEY)
			expect(pointer.etag).toBe(target.etag)
		})

		it('unpublishes: public object and pointer gone, source kept, draft state', async () => {
			await unpublishVideo(deps, 'bodhicitta-part-1')
			await expect(s3.headObject(PUBLIC_BUCKET, KEY)).rejects.toThrowError(
				NotFoundError,
			)
			await expect(s3.headObject(PRIVATE_BUCKET, POINTER)).rejects.toThrowError(
				NotFoundError,
			)
			expect((await s3.headObject(PRIVATE_BUCKET, KEY)).size).toBeGreaterThan(0)
			const note = await notes.getNote(PATH)
			expect(note.frontmatter.publication_state).toBe('draft')
			expect(note.frontmatter.visibility).toBe('private')
		})

		it('refuses to unpublish twice', async () => {
			await expect(
				unpublishVideo(deps, 'bodhicitta-part-1'),
			).rejects.toThrowError(ValidationError)
		})
	},
)
