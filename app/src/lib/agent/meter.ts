import { createRateLimiter, type RateLimiter } from '../auth/ratelimit.js'
import { BudgetExceededError, RateLimitError } from '../errors.js'

export interface UsageMeter {
	/**
	 * Charge tokens against the key's window.
	 *
	 * @param key - session subject or IP
	 * @param tokens - approximate token count
	 * @throws BudgetExceededError when the window budget is exhausted
	 */
	charge(key: string, tokens: number): void
	/**
	 * @param key - session subject or IP
	 * @returns tokens charged in the current window
	 */
	spent(key: string): number
}

interface MeterOptions {
	budgetTokens: number
	/** Budget window in milliseconds; defaults to one hour. */
	windowMs?: number
	now?: () => number
}

interface MeterEntry {
	at: number
	tokens: number
}

/**
 * Per-key usage budget with a sliding window (ADR-0004 cost control).
 *
 * @param opts - budget, window, injectable clock
 * @returns UsageMeter
 */
export function createUsageMeter(opts: MeterOptions): UsageMeter {
	const now = opts.now ?? Date.now
	const windowMs = opts.windowMs ?? 3_600_000
	const usage = new Map<string, MeterEntry[]>()

	const inWindow = (key: string): MeterEntry[] => {
		const start = now() - windowMs
		const entries = (usage.get(key) ?? []).filter((e) => e.at > start)
		usage.set(key, entries)
		return entries
	}

	return {
		charge(key, tokens) {
			const entries = inWindow(key)
			const total = entries.reduce((sum, e) => sum + e.tokens, 0)
			if (total + tokens > opts.budgetTokens) throw new BudgetExceededError()
			entries.push({ at: now(), tokens })
		},
		spent(key) {
			return inWindow(key).reduce((sum, e) => sum + e.tokens, 0)
		},
	}
}

export interface AgentGate {
	/**
	 * Check whether a request may start (rate limit), keyed by caller.
	 *
	 * @param key - IP or session subject
	 * @throws RateLimitError when over the limit
	 */
	admit(key: string): void
	meter: UsageMeter
}

/**
 * Combined admission (rate limit) + metering gate for the agent route.
 *
 * @param opts - limits and window
 * @returns AgentGate
 */
export function createAgentGate(opts: {
	rateLimitPerWindow: number
	windowMs: number
	budgetTokens: number
	now?: () => number
}): AgentGate {
	const limiter: RateLimiter = createRateLimiter({
		limit: opts.rateLimitPerWindow,
		windowMs: opts.windowMs,
		now: opts.now,
	})
	const meter = createUsageMeter({
		budgetTokens: opts.budgetTokens,
		windowMs: opts.windowMs,
		now: opts.now,
	})
	return {
		admit(key) {
			if (!limiter.check(key)) throw new RateLimitError()
		},
		meter,
	}
}
