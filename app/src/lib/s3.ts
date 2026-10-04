import { createHash } from 'node:crypto'
import {
	CopyObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { AppConfig } from './env/config.js'
import { NotFoundError } from './errors.js'

/** Stat of an object: size in bytes and normalized (unquoted) ETag. */
export interface ObjectStat {
	size: number
	etag: string
}

/**
 * The object-storage operations the BFF needs (ADR-0004).
 *
 * The real implementation talks S3 (R2-compatible); tests inject
 * inMemoryS3. All keys are media keys; callers must run assertMediaKey
 * before minting presigned URLs.
 */
export interface S3Ops {
	headObject(bucket: string, key: string): Promise<ObjectStat>
	getObject(bucket: string, key: string): Promise<string>
	copyObject(
		sourceBucket: string,
		sourceKey: string,
		destBucket: string,
		destKey: string,
	): Promise<void>
	deleteObject(bucket: string, key: string): Promise<void>
	putObject(
		bucket: string,
		key: string,
		body: string,
		contentType?: string,
	): Promise<void>
	presignPut(
		bucket: string,
		key: string,
		expiresSeconds: number,
	): Promise<string>
	presignGet(
		bucket: string,
		key: string,
		expiresSeconds: number,
	): Promise<string>
}

function normalizeEtag(raw: string | undefined): string {
	return (raw ?? '').replace(/^"|"$/g, '')
}

/**
 * Create S3 operations against the R2-compatible endpoint.
 *
 * @param cfg - app config (S3 section)
 * @returns S3Ops backed by @aws-sdk/client-s3
 */
export function createS3Ops(cfg: AppConfig): S3Ops {
	const client = new S3Client({
		endpoint: cfg.s3.endpointUrl,
		region: cfg.s3.region,
		credentials: {
			accessKeyId: cfg.s3.accessKeyId,
			secretAccessKey: cfg.s3.secretAccessKey,
		},
		forcePathStyle: true,
	})

	return {
		async headObject(bucket, key) {
			const res = await client.send(
				new HeadObjectCommand({ Bucket: bucket, Key: key }),
			)
			return { size: res.ContentLength ?? 0, etag: normalizeEtag(res.ETag) }
		},
		async getObject(bucket, key) {
			const res = await client.send(
				new GetObjectCommand({ Bucket: bucket, Key: key }),
			)
			if (res.Body === undefined)
				throw new NotFoundError(`object not found: ${bucket}/${key}`)
			const bytes = await res.Body.transformToByteArray()
			return new TextDecoder().decode(bytes)
		},
		async copyObject(sourceBucket, sourceKey, destBucket, destKey) {
			await client.send(
				new CopyObjectCommand({
					Bucket: destBucket,
					Key: destKey,
					CopySource: `${sourceBucket}/${sourceKey}`,
				}),
			)
		},
		async deleteObject(bucket, key) {
			await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
		},
		async putObject(
			bucket,
			key,
			body,
			contentType = 'application/octet-stream',
		) {
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: body,
					ContentType: contentType,
				}),
			)
		},
		async presignPut(bucket, key, expiresSeconds) {
			return getSignedUrl(
				client,
				new PutObjectCommand({ Bucket: bucket, Key: key }),
				{ expiresIn: expiresSeconds },
			)
		},
		async presignGet(bucket, key, expiresSeconds) {
			return getSignedUrl(
				client,
				new GetObjectCommand({ Bucket: bucket, Key: key }),
				{ expiresIn: expiresSeconds },
			)
		},
	}
}

interface FakeObject {
	body: string
	size: number
	etag: string
}

/**
 * In-memory S3Ops for offline unit tests.
 *
 * ETags are sha256 hex of the body, mimicking R2's single-PUT objects.
 *
 * @param initial - optional seed objects keyed `bucket/key`
 * @returns S3Ops plus a `store` for test assertions
 */
export function inMemoryS3(
	initial?: Record<string, string>,
): S3Ops & { store: Map<string, FakeObject> } {
	const store = new Map<string, FakeObject>()
	const seed = (bucket: string, key: string, body: string): void => {
		store.set(`${bucket}/${key}`, {
			body,
			size: body.length,
			etag: createHash('sha256').update(body).digest('hex'),
		})
	}
	if (initial) {
		for (const [bucketKey, body] of Object.entries(initial)) {
			const idx = bucketKey.indexOf('/')
			seed(bucketKey.slice(0, idx), bucketKey.slice(idx + 1), body)
		}
	}
	const lookup = (bucket: string, key: string): FakeObject => {
		const obj = store.get(`${bucket}/${key}`)
		if (obj === undefined)
			throw new NotFoundError(`object not found: ${bucket}/${key}`)
		return obj
	}

	return {
		store,
		async headObject(bucket, key) {
			const obj = lookup(bucket, key)
			return { size: obj.size, etag: obj.etag }
		},
		async getObject(bucket, key) {
			return lookup(bucket, key).body
		},
		async copyObject(sourceBucket, sourceKey, destBucket, destKey) {
			const obj = lookup(sourceBucket, sourceKey)
			store.set(`${destBucket}/${destKey}`, { ...obj })
		},
		async deleteObject(bucket, key) {
			store.delete(`${bucket}/${key}`)
		},
		async putObject(bucket, key, body) {
			seed(bucket, key, body)
		},
		async presignPut(bucket, key, expiresSeconds) {
			return `https://fake-r2.local/${bucket}/${key}?op=put&exp=${expiresSeconds}`
		},
		async presignGet(bucket, key, expiresSeconds) {
			return `https://fake-r2.local/${bucket}/${key}?op=get&exp=${expiresSeconds}`
		},
	}
}
