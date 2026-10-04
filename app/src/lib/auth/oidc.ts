import { Google } from 'arctic'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/** Identity assertion returned by an OIDC provider. */
export interface OidcIdentity {
	email: string
	emailVerified: boolean
	name?: string
}

/**
 * OIDC provider abstraction (ADR-0004 review finding 3).
 *
 * GoogleOidc implements the real flow (arctic + JWKS verification); tests
 * inject a deterministic fake.
 */
export interface OidcProvider {
	/**
	 * Build the authorization redirect URL.
	 *
	 * @param state - CSRF state value
	 * @param codeVerifier - PKCE code verifier
	 * @returns authorization endpoint URL
	 */
	startUrl(state: string, codeVerifier: string): Promise<string>
	/**
	 * Exchange an authorization code for a verified identity.
	 *
	 * @param code - authorization code
	 * @param codeVerifier - PKCE code verifier
	 * @returns verified identity
	 */
	exchange(code: string, codeVerifier: string): Promise<OidcIdentity>
}

interface GoogleConfig {
	clientId: string
	clientSecret: string
	redirectUri: string
}

const googleJwks = createRemoteJWKSet(
	new URL('https://www.googleapis.com/oauth2/v3/certs'),
)

/**
 * Google OpenID Connect provider (authorization code + PKCE, ADR-0005).
 *
 * The ID token is verified against Google's JWKS with issuer and audience
 * checks before any claim is trusted.
 */
export class GoogleOidc implements OidcProvider {
	readonly #cfg: GoogleConfig
	readonly #google: Google

	constructor(cfg: GoogleConfig) {
		this.#cfg = cfg
		this.#google = new Google(cfg.clientId, cfg.clientSecret, cfg.redirectUri)
	}

	async startUrl(state: string, codeVerifier: string): Promise<string> {
		// arctic applies S256 PKCE from the verifier (ADR-0005).
		return this.#google
			.createAuthorizationURL(state, codeVerifier, [
				'openid',
				'email',
				'profile',
			])
			.toString()
	}

	async exchange(code: string, codeVerifier: string): Promise<OidcIdentity> {
		const tokens = await this.#google.validateAuthorizationCode(
			code,
			codeVerifier,
		)
		const idToken = await tokens.idToken()
		if (idToken === null) throw new Error('no id token in token response')
		const { payload } = await jwtVerify(idToken, googleJwks, {
			issuer: 'https://accounts.google.com',
			audience: this.#cfg.clientId,
		})
		const email = typeof payload.email === 'string' ? payload.email : ''
		if (email === '') throw new Error('id token has no email claim')
		return {
			email,
			emailVerified: payload.email_verified === true,
			name: typeof payload.name === 'string' ? payload.name : undefined,
		}
	}
}

/**
 * Deterministic provider for tests.
 *
 * Records calls so tests can assert state/codeVerifier threading.
 */
export class FakeOidc implements OidcProvider {
	readonly calls: {
		start: [state: string, verifier: string][]
		exchange: [code: string, verifier: string][]
	} = {
		start: [],
		exchange: [],
	}

	constructor(
		private readonly identity: OidcIdentity,
		private readonly code: string = 'c0de',
		private readonly verifier: string = 'verifier',
	) {}

	async startUrl(state: string, codeVerifier: string): Promise<string> {
		this.calls.start.push([state, codeVerifier])
		return `https://auth.example/fake?state=${encodeURIComponent(state)}`
	}

	async exchange(code: string, codeVerifier: string): Promise<OidcIdentity> {
		this.calls.exchange.push([code, codeVerifier])
		if (code !== this.code) throw new Error('invalid authorization code')
		if (codeVerifier !== this.verifier)
			throw new Error('code verifier mismatch')
		return this.identity
	}
}
