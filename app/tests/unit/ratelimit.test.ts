import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/lib/auth/ratelimit.js'

describe('rate limiter', () => {
	it('allows up to the limit inside the window', () => {
		const t = 1_000_000
		const limiter = createRateLimiter({
			limit: 2,
			windowMs: 1000,
			now: () => t,
		})
		expect(limiter.check('k')).toBe(true)
		expect(limiter.check('k')).toBe(true)
		expect(limiter.check('k')).toBe(false)
	})

	it('recovers after the window slides', () => {
		let t = 1_000_000
		const limiter = createRateLimiter({
			limit: 1,
			windowMs: 1000,
			now: () => t,
		})
		expect(limiter.check('k')).toBe(true)
		expect(limiter.check('k')).toBe(false)
		t += 1001
		expect(limiter.check('k')).toBe(true)
	})

	it('keys are independent', () => {
		const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })
		expect(limiter.check('a')).toBe(true)
		expect(limiter.check('b')).toBe(true)
		expect(limiter.check('a')).toBe(false)
	})
})
