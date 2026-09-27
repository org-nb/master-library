export type Environment = 'dev' | 'prod'
export type StorageBackend = 'r2' | 'stream' | 's3'

export interface RuntimeConfig {
	environment: Environment
	accountId?: string
	defaultR2LocationId: string
	mediaBucketName?: string
	catalogStorageBinding: string
	d1Binding: string
}

export function parseRuntimeConfig(env: Record<string, unknown>): RuntimeConfig {
	const environment = (env.ENVIRONMENT as Environment) || 'dev'
	const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID : undefined
	const defaultR2LocationId =
		typeof env.DEFAULT_R2_LOCATION_ID === 'string' ? env.DEFAULT_R2_LOCATION_ID : `loc-r2-${environment}`
	const mediaBucketName = typeof env.MEDIA_BUCKET_NAME === 'string' ? env.MEDIA_BUCKET_NAME : undefined

	return {
		environment,
		accountId,
		defaultR2LocationId,
		mediaBucketName,
		catalogStorageBinding: 'CATALOG_STORAGE',
		d1Binding: 'DB',
	}
}
