import { describe, expect, it } from 'vitest'
import { findUser, parseAllowlist } from '../../src/lib/auth/allowlist.js'

describe('allowlist', () => {
	it('parses per-user secrets in order', () => {
		const problems: string[] = []
		const users = parseAllowlist(
			{
				OAUTH_USER_COUNT: '2',
				OAUTH_USER_1: 'Alice@Example.org|librarian',
				OAUTH_USER_2: 'b@x.org|member',
			},
			problems,
		)
		expect(problems).toEqual([])
		expect(users).toEqual([
			{ email: 'alice@example.org', role: 'librarian' },
			{ email: 'b@x.org', role: 'member' },
		])
	})

	it('reports malformed entries and count problems', () => {
		const problems: string[] = []
		parseAllowlist({ OAUTH_USER_COUNT: '2', OAUTH_USER_1: 'bad' }, problems)
		expect(problems).toContain('OAUTH_USER_1 must be set to email|role')
		const problems2: string[] = []
		parseAllowlist({ OAUTH_USER_COUNT: '-1' }, problems2)
		expect(problems2).toContain(
			'OAUTH_USER_COUNT must be a non-negative integer',
		)
	})

	it('matches case-insensitively but only verified emails', () => {
		const problems: string[] = []
		const users = parseAllowlist(
			{ OAUTH_USER_COUNT: '1', OAUTH_USER_1: 'a@b.org|librarian' },
			problems,
		)
		expect(findUser(users, 'A@B.ORG', true)).toEqual({
			email: 'a@b.org',
			role: 'librarian',
		})
		expect(findUser(users, 'A@B.ORG', false)).toBeNull()
		expect(findUser(users, 'other@b.org', true)).toBeNull()
	})

	it('is empty when no count is set', () => {
		const problems: string[] = []
		expect(parseAllowlist({}, problems)).toEqual([])
		expect(problems).toEqual([])
	})
})
