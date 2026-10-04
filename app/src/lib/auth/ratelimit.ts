/**
 * Sliding-window in-memory rate limiter (single container, ADR-0004).
 *
 * Sufficient for one replica; a shared store is a later increment if the
 * container ever scales out.
 */
export interface RateLimiter {
	/**
	 * Record one hit for the key.
	 *
	 * @param key - limiter key (IP or session subject)
	 * @returns false when the limit for the current window is exceeded
	 */
	check(key: string): boolean
}

interface LimiterOptions {
	limit: number
	windowMs: number
	now?: () => number
}

/**
 * Create a sliding-window rate limiter.
 *
 * @param opts - limit, window, injectable clock for tests
 * @returns RateLimiter
 */
export function createRateLimiter(opts: LimiterOptions): RateLimiter {
	const now = opts.now ?? Date.now
	const hits = new Map<string, number[]>()

	return {
		check(key) {
			const windowStart = now() - opts.windowMs
			const recent = (hits.get(key) ?? []).filter((t) => t > windowStart)
			if (recent.length >= opts.limit) {
				hits.set(key, recent)
				return false
			}
			recent.push(now())
			hits.set(key, recent)
			return true
		},
	}
}
