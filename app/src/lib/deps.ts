import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LlmProvider } from './agent/llm.js'
import { OpenAiCompatibleLlm } from './agent/llm.js'
import { type AgentGate, createAgentGate } from './agent/meter.js'
import { GoogleOidc, type OidcProvider } from './auth/oidc.js'
import type { AppConfig } from './env/config.js'
import { loadConfig } from './env/config.js'
import { createOxivaultClient, type OxivaultClient } from './oxivault/client.js'
import {
	type EventRegistry,
	loadEventRegistry,
	loadPlaceRegistry,
	type PlaceRegistry,
} from './registry.js'
import { createS3Ops, type S3Ops } from './s3.js'

/**
 * All long-lived collaborators for the BFF, built once from the
 * environment (ADR-0004: the route layer is the single wiring boundary).
 */
export interface AppDeps {
	cfg: AppConfig
	notes: OxivaultClient
	s3: S3Ops
	places: PlaceRegistry
	events: EventRegistry
	oidc: OidcProvider
	agentGate: AgentGate
	/** null when no LLM provider is configured; the agent route returns 503. */
	llm: LlmProvider | null
}

/**
 * Load registry JSON files from the registries directory.
 *
 * Fails closed: a missing or malformed registry file is a startup error,
 * because every canonical key depends on it.
 *
 * @param dir - registries directory
 * @returns place and event registries
 */
export async function loadRegistries(
	dir: string,
): Promise<{ places: PlaceRegistry; events: EventRegistry }> {
	const [placesRaw, eventsRaw] = await Promise.all([
		readFile(join(dir, 'places.json'), 'utf8'),
		readFile(join(dir, 'events.json'), 'utf8'),
	])
	return {
		places: loadPlaceRegistry(JSON.parse(placesRaw)),
		events: loadEventRegistry(JSON.parse(eventsRaw)),
	}
}

/**
 * Build the full dependency set from an environment mapping.
 *
 * @param env - environment mapping (process.env in production)
 * @returns AppDeps
 */
export async function buildDeps(
	env: Record<string, string | undefined>,
): Promise<AppDeps> {
	const cfg = loadConfig(env)
	const { places, events } = await loadRegistries(cfg.registriesDir)
	const llm =
		env.LLM_API_BASE && env.LLM_API_KEY && env.LLM_MODEL
			? new OpenAiCompatibleLlm({
					baseUrl: env.LLM_API_BASE,
					apiKey: env.LLM_API_KEY,
					model: env.LLM_MODEL,
				})
			: null
	return {
		cfg,
		notes: createOxivaultClient({
			baseUrl: cfg.oxivault.baseUrl,
			token: cfg.oxivault.editorToken,
		}),
		s3: createS3Ops(cfg),
		places,
		events,
		oidc: new GoogleOidc(cfg.google),
		agentGate: createAgentGate({
			rateLimitPerWindow: 20,
			windowMs: 60_000,
			budgetTokens: 100_000,
		}),
		llm,
	}
}

let cached: AppDeps | undefined

/**
 * Process-wide dependency singleton (route wiring boundary only; all
 * library modules take dependencies as arguments).
 */
export async function getDeps(): Promise<AppDeps> {
	if (cached === undefined) {
		cached = await buildDeps(process.env)
	}
	return cached
}

/** Test hook: drop the cached singleton. */
export function resetDeps(): void {
	cached = undefined
}
