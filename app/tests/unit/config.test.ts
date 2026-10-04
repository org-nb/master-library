import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/lib/env/config.js'

const validEnv: Record<string, string> = {
	APP_ORIGIN: 'http://localhost:5173',
	PUBLIC_MEDIA_BASE_URL: 'http://media.example.org',
	S3_ENDPOINT_URL: 'https://acct.r2.cloudflarestorage.com',
	S3_ACCESS_KEY_ID: 'ak',
	S3_SECRET_ACCESS_KEY: 'sk',
	R2_BUCKET_PRIVATE: 'master-library-media-private-dev',
	R2_BUCKET_PUBLIC: 'master-library-media-public-dev',
	OXIVAULT_EDITOR_TOKEN: 'loopback-editor',
	GOOGLE_CLIENT_ID: 'client',
	GOOGLE_CLIENT_SECRET: 'secret',
	SESSION_SECRET: '01234567890123456789012345678901',
	OAUTH_USER_COUNT: '2',
	OAUTH_USER_1: 'alice@example.org|librarian',
	OAUTH_USER_2: 'bob@example.org|member',
}

describe('loadConfig', () => {
	it('parses a valid environment', () => {
		const cfg = loadConfig(validEnv)
		expect(cfg.s3.privateBucket).toBe('master-library-media-private-dev')
		expect(cfg.s3.vaultPrefix).toBe('vault')
		expect(cfg.publicMediaBaseUrl).toBe('http://media.example.org')
		expect(cfg.oxivault.baseUrl).toBe('http://127.0.0.1:8000')
		expect(cfg.google.redirectUri).toBe(
			'http://localhost:5173/auth/google/callback',
		)
		expect(cfg.session.ttlMs).toBe(43_200_000)
		expect(cfg.allowlist).toEqual([
			{ email: 'alice@example.org', role: 'librarian' },
			{ email: 'bob@example.org', role: 'member' },
		])
	})

	it('collects all problems instead of failing on the first', () => {
		const bad = { APP_ORIGIN: 'not a url', SESSION_SECRET: 'short' }
		expect(() => loadConfig(bad)).toThrowError(ConfigError)
		try {
			loadConfig(bad)
		} catch (err) {
			const issues = (err as ConfigError).issues
			expect(issues).toContain('APP_ORIGIN must be a valid URL')
			expect(issues).toContain('missing S3_ENDPOINT_URL')
			expect(issues).toContain('SESSION_SECRET must be at least 32 characters')
			expect(issues).toContain('missing GOOGLE_CLIENT_ID')
		}
	})

	it('rejects allowlist entries with a wrong role', () => {
		expect(() =>
			loadConfig({ ...validEnv, OAUTH_USER_1: 'alice@example.org|admin' }),
		).toThrowError(/OAUTH_USER_1/)
	})

	it('rejects allowlist count mismatches', () => {
		expect(() =>
			loadConfig({ ...validEnv, OAUTH_USER_COUNT: '3' }),
		).toThrowError(/OAUTH_USER_3/)
	})

	it('strips a trailing slash from the public media base URL', () => {
		const cfg = loadConfig({
			...validEnv,
			PUBLIC_MEDIA_BASE_URL: 'http://media.example.org/',
		})
		expect(cfg.publicMediaBaseUrl).toBe('http://media.example.org')
	})
})
