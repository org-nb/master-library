import { z } from 'zod'
import { ValidationError } from './errors.js'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/

/**
 * Immutable 1:1 mapping of place IRI to kebab-case slug (ADR-0003).
 */
export interface PlaceRegistry {
	iriToSlug: ReadonlyMap<string, string>
	slugToIri: ReadonlyMap<string, string>
	labels: ReadonlyMap<string, string>
}

const placeEntry = z.object({
	iri: z.string().url(),
	slug: z.string().regex(SLUG_RE, 'slug must be kebab-case'),
	label: z.string().min(1),
})

/**
 * Load a place registry from raw entries (fixture JSON or config).
 *
 * Enforces the 1:1 mapping: a duplicate IRI or slug is a load error, not a
 * runtime ambiguity.
 *
 * @param entries - raw array of place entries
 * @returns registry maps
 * @throws ValidationError when entries are malformed or inconsistent
 */
export function loadPlaceRegistry(entries: unknown): PlaceRegistry {
	const parsed = z.array(placeEntry).safeParse(entries)
	if (!parsed.success) {
		throw new ValidationError(
			'invalid place registry',
			parsed.error.issues.map((i) => i.message),
		)
	}
	const iriToSlug = new Map<string, string>()
	const slugToIri = new Map<string, string>()
	const labels = new Map<string, string>()
	for (const entry of parsed.data) {
		if (iriToSlug.has(entry.iri))
			throw new ValidationError(`duplicate place iri ${entry.iri}`)
		if (slugToIri.has(entry.slug))
			throw new ValidationError(`duplicate place slug ${entry.slug}`)
		iriToSlug.set(entry.iri, entry.slug)
		slugToIri.set(entry.slug, entry.iri)
		labels.set(entry.iri, entry.label)
	}
	return { iriToSlug, slugToIri, labels }
}

/**
 * @param registry - place registry
 * @param iri - place IRI
 * @returns the mapped slug, or null when the IRI is unregistered
 */
export function slugForPlaceIri(
	registry: PlaceRegistry,
	iri: string,
): string | null {
	return registry.iriToSlug.get(iri) ?? null
}

/**
 * @param registry - place registry
 * @param slug - place slug
 * @returns the mapped IRI, or null when the slug is unregistered
 */
export function iriForPlaceSlug(
	registry: PlaceRegistry,
	slug: string,
): string | null {
	return registry.slugToIri.get(slug) ?? null
}

export interface EventEntry {
	id: string
	slug: string
	title: string
}

/**
 * Immutable 1:1 mapping of event id to slug (ADR-0003 event identity).
 */
export interface EventRegistry {
	idToSlug: ReadonlyMap<string, string>
	slugToId: ReadonlyMap<string, string>
	titles: ReadonlyMap<string, string>
}

const eventEntry = z.object({
	id: z.string().regex(ID_RE, 'id must match [a-z0-9][a-z0-9_-]*'),
	slug: z.string().regex(SLUG_RE, 'slug must be kebab-case'),
	title: z.string().min(1),
})

/**
 * Load an event registry from raw entries.
 *
 * @param entries - raw array of event entries
 * @returns registry maps
 * @throws ValidationError when entries are malformed or inconsistent
 */
export function loadEventRegistry(entries: unknown): EventRegistry {
	const parsed = z.array(eventEntry).safeParse(entries)
	if (!parsed.success) {
		throw new ValidationError(
			'invalid event registry',
			parsed.error.issues.map((i) => i.message),
		)
	}
	const idToSlug = new Map<string, string>()
	const slugToId = new Map<string, string>()
	const titles = new Map<string, string>()
	for (const entry of parsed.data) {
		if (idToSlug.has(entry.id))
			throw new ValidationError(`duplicate event id ${entry.id}`)
		if (slugToId.has(entry.slug))
			throw new ValidationError(`duplicate event slug ${entry.slug}`)
		idToSlug.set(entry.id, entry.slug)
		slugToId.set(entry.slug, entry.id)
		titles.set(entry.id, entry.title)
	}
	return { idToSlug, slugToId, titles }
}

/**
 * @param registry - event registry
 * @param id - event id
 * @returns the mapped slug, or null when the id is unregistered
 */
export function slugForEventId(
	registry: EventRegistry,
	id: string,
): string | null {
	return registry.idToSlug.get(id) ?? null
}
