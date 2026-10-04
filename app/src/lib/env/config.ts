import { z } from 'zod'
import { type AllowlistUser, parseAllowlist } from '../auth/allowlist.js'

export class ConfigError extends Error {
	readonly issues: string[]

	constructor(issues: string[]) {
		super(`invalid configuration: ${issues.join('; ')}`)
		this.name = 'ConfigError'
		this.issues = issues
	}
}

const url = z.string().url()

export interface AppConfig {
	appOrigin: string
	publicMediaBaseUrl: string
	s3: {
		endpointUrl: string
		region: string
		accessKeyId: string
		secretAccessKey: string
		privateBucket: string
		publicBucket: string
		vaultPrefix: string
	}
	oxivault: {
		baseUrl: string
		editorToken: string
	}
	google: {
		clientId: string
		clientSecret: string
		redirectUri: string
	}
	session: {
		secret: string
		cookie: string
		ttlMs: number
	}
	registriesDir: string
	allowlist: AllowlistUser[]
}

/**
 * Parse and validate the application environment.
 *
 * Fails closed: any missing or invalid value is collected and raised as a
 * single ConfigError listing every problem.
 *
 * @param env - environment mapping (process.env in production)
 * @returns fully typed configuration
 * @throws ConfigError when any required value is missing or invalid
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
	const problems: string[] = []
	const required = (name: string): string | undefined => {
		const value = env[name]
		if (value === undefined || value === '') {
			problems.push(`missing ${name}`)
			return undefined
		}
		return value
	}

	// URL fields: distinguish "missing" from "malformed" so each problem
	// is reported exactly once.
	const urlField = (name: string, fallback?: string): string | undefined => {
		const value = env[name] ?? fallback
		if (value === undefined || value === '') {
			problems.push(`missing ${name}`)
			return fallback
		}
		if (!url.safeParse(value).success)
			problems.push(`${name} must be a valid URL`)
		return value
	}

	const appOrigin = urlField('APP_ORIGIN')
	const publicMediaBaseUrl = urlField('PUBLIC_MEDIA_BASE_URL')
	const endpoint = urlField('S3_ENDPOINT_URL')
	const vaultBase = urlField('OXIVAULT_BASE_URL', 'http://127.0.0.1:8000')

	const sessionSecret = required('SESSION_SECRET')
	if (sessionSecret !== undefined && sessionSecret.length < 32) {
		problems.push('SESSION_SECRET must be at least 32 characters')
	}
	const ttlRaw = env.SESSION_TTL_MS ?? String(12 * 60 * 60 * 1000)
	const ttl = Number(ttlRaw)
	if (!Number.isInteger(ttl) || ttl <= 0)
		problems.push('SESSION_TTL_MS must be a positive integer')

	const allowlist = parseAllowlist(env, problems)

	// Collect every remaining required value before failing, so an operator
	// sees the full list of gaps in one shot.
	required('S3_ACCESS_KEY_ID')
	required('S3_SECRET_ACCESS_KEY')
	required('R2_BUCKET_PRIVATE')
	required('R2_BUCKET_PUBLIC')
	required('OXIVAULT_EDITOR_TOKEN')
	required('GOOGLE_CLIENT_ID')
	required('GOOGLE_CLIENT_SECRET')

	if (problems.length > 0) throw new ConfigError(problems)

	return {
		appOrigin: appOrigin as string,
		publicMediaBaseUrl: (publicMediaBaseUrl as string).replace(/\/+$/, ''),
		s3: {
			endpointUrl: endpoint as string,
			region: env.S3_REGION ?? 'us-east-1',
			accessKeyId: required('S3_ACCESS_KEY_ID') ?? '',
			secretAccessKey: required('S3_SECRET_ACCESS_KEY') ?? '',
			privateBucket: required('R2_BUCKET_PRIVATE') ?? '',
			publicBucket: required('R2_BUCKET_PUBLIC') ?? '',
			vaultPrefix: env.VAULT_PREFIX ?? 'vault',
		},
		oxivault: {
			baseUrl: (vaultBase as string).replace(/\/+$/, ''),
			editorToken: required('OXIVAULT_EDITOR_TOKEN') ?? '',
		},
		google: {
			clientId: required('GOOGLE_CLIENT_ID') ?? '',
			clientSecret: required('GOOGLE_CLIENT_SECRET') ?? '',
			redirectUri: `${(appOrigin as string).replace(/\/+$/, '')}/auth/google/callback`,
		},
		session: {
			secret: sessionSecret ?? '',
			cookie: 'ml_session',
			ttlMs: ttl,
		},
		registriesDir: env.REGISTRIES_DIR ?? 'fixtures/registries',
		allowlist,
	}
}
