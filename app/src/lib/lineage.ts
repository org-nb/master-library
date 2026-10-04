import { type ContentTier, parseVersionId } from './keys.js'

export interface SourceRange {
	sourceVersionId: string
	startSeconds: number
	endSeconds: number
}

/** Lineage declaration of an item (ADR-0003 required lineage metadata). */
export interface LineageSpec {
	contentTier: ContentTier
	sourceEpisodeIds: string[]
	sourceVersionIds: string[]
	sourceRanges: SourceRange[]
}

/**
 * Validate the tier and lineage rules of ADR-0003.
 *
 * - recording items must not declare any source lineage;
 * - edit/short items must declare at least one source episode, source
 *   version and source range;
 * - every range must reference a declared source version, have
 *   start < end, and belong to a declared source episode.
 *
 * @param spec - lineage declaration
 * @returns list of problems; empty when the spec is valid
 */
export function validateLineage(spec: LineageSpec): string[] {
	const issues: string[] = []
	const { contentTier, sourceEpisodeIds, sourceVersionIds, sourceRanges } = spec

	if (contentTier === 'recording') {
		if (
			sourceEpisodeIds.length > 0 ||
			sourceVersionIds.length > 0 ||
			sourceRanges.length > 0
		) {
			issues.push('recording items must not declare source lineage')
		}
		return issues
	}

	if (sourceEpisodeIds.length === 0)
		issues.push('derived items require at least one source episode')
	if (sourceVersionIds.length === 0)
		issues.push('derived items require at least one source version')
	if (sourceRanges.length === 0)
		issues.push('derived items require at least one source range')

	const declaredVersions = new Set(sourceVersionIds)
	for (const versionId of sourceVersionIds) {
		const parsed = parseVersionId(versionId)
		if (parsed === null) {
			issues.push(`source version id ${versionId} is malformed`)
			continue
		}
		if (!sourceEpisodeIds.includes(parsed.episodeId)) {
			issues.push(
				`source version ${versionId} references undeclared episode ${parsed.episodeId}`,
			)
		}
	}

	for (const range of sourceRanges) {
		if (!Number.isFinite(range.startSeconds) || range.startSeconds < 0) {
			issues.push(
				`source range start_seconds must be >= 0 (got ${range.startSeconds})`,
			)
		}
		if (
			!Number.isFinite(range.endSeconds) ||
			range.endSeconds <= range.startSeconds
		) {
			issues.push(`source range end_seconds must be greater than start_seconds`)
		}
		if (!declaredVersions.has(range.sourceVersionId)) {
			issues.push(
				`source range references undeclared version ${range.sourceVersionId}`,
			)
		}
	}

	return issues
}
