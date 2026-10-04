import { describe, expect, it } from 'vitest'
import { type LineageSpec, validateLineage } from '../../src/lib/lineage.js'

const recording: LineageSpec = {
	contentTier: 'recording',
	sourceEpisodeIds: [],
	sourceVersionIds: [],
	sourceRanges: [],
}

const derived: LineageSpec = {
	contentTier: 'edit',
	sourceEpisodeIds: ['ep_abcd1234'],
	sourceVersionIds: ['ep_abcd1234:v1'],
	sourceRanges: [
		{ sourceVersionId: 'ep_abcd1234:v1', startSeconds: 120, endSeconds: 180 },
	],
}

describe('lineage validation (ADR-0003)', () => {
	it('accepts a clean recording', () => {
		expect(validateLineage(recording)).toEqual([])
	})

	it('accepts a valid derived item', () => {
		expect(validateLineage(derived)).toEqual([])
	})

	it('rejects source lineage on recordings', () => {
		const issues = validateLineage({ ...recording, sourceEpisodeIds: ['ep_x'] })
		expect(issues).toContain('recording items must not declare source lineage')
	})

	it('requires episode, version and range on derived items', () => {
		expect(validateLineage({ ...derived, sourceEpisodeIds: [] })).toContain(
			'derived items require at least one source episode',
		)
		expect(validateLineage({ ...derived, sourceVersionIds: [] })).toContain(
			'derived items require at least one source version',
		)
		expect(validateLineage({ ...derived, sourceRanges: [] })).toContain(
			'derived items require at least one source range',
		)
	})

	it('requires version ids to reference declared episodes', () => {
		const issues = validateLineage({
			...derived,
			sourceVersionIds: ['ep_other:v1'],
		})
		expect(issues).toContain(
			'source version ep_other:v1 references undeclared episode ep_other',
		)
	})

	it('rejects malformed version ids', () => {
		const issues = validateLineage({
			...derived,
			sourceVersionIds: ['garbage'],
		})
		expect(issues).toContain('source version id garbage is malformed')
	})

	it('validates range bounds and version references', () => {
		const badBounds = validateLineage({
			...derived,
			sourceRanges: [
				{
					sourceVersionId: 'ep_abcd1234:v1',
					startSeconds: 300,
					endSeconds: 100,
				},
			],
		})
		expect(badBounds).toContain(
			'source range end_seconds must be greater than start_seconds',
		)

		const undeclared = validateLineage({
			...derived,
			sourceRanges: [
				{ sourceVersionId: 'ep_x:v1', startSeconds: 0, endSeconds: 10 },
			],
		})
		expect(undeclared).toContain(
			'source range references undeclared version ep_x:v1',
		)
	})

	it('collects multiple problems at once', () => {
		const issues = validateLineage({
			contentTier: 'short',
			sourceEpisodeIds: [],
			sourceVersionIds: [],
			sourceRanges: [],
		})
		expect(issues).toHaveLength(3)
	})
})
