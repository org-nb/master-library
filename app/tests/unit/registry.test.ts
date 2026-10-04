import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/lib/errors.js'
import {
	iriForPlaceSlug,
	loadEventRegistry,
	loadPlaceRegistry,
	slugForEventId,
	slugForPlaceIri,
} from '../../src/lib/registry.js'

const places = [
	{
		iri: 'http://sws.geonames.org/1252634',
		slug: 'bodhgaya',
		label: 'Bodh Gaya',
	},
	{
		iri: 'http://sws.geonames.org/5128581',
		slug: 'nalandabodhi-ny',
		label: 'NY',
	},
]

const events = [
	{ id: 'evt_2026_winter', slug: 'winter-retreat-2026', title: 'Winter' },
	{ id: 'evt_2026_spring', slug: 'spring-teachings-2026', title: 'Spring' },
]

describe('registries', () => {
	it('maps place iri and slug 1:1', () => {
		const reg = loadPlaceRegistry(places)
		expect(slugForPlaceIri(reg, 'http://sws.geonames.org/1252634')).toBe(
			'bodhgaya',
		)
		expect(iriForPlaceSlug(reg, 'bodhgaya')).toBe(
			'http://sws.geonames.org/1252634',
		)
		expect(slugForPlaceIri(reg, 'http://unknown.example/x')).toBeNull()
	})

	it('rejects duplicate iri or slug at load time', () => {
		expect(() =>
			loadPlaceRegistry([...places, { ...places[0], slug: 'other' }]),
		).toThrowError(ValidationError)
		expect(() =>
			loadPlaceRegistry([...places, { ...places[0], label: 'dup' }]),
		).toThrowError(/duplicate place iri/)
	})

	it('rejects malformed entries', () => {
		expect(() =>
			loadPlaceRegistry([{ iri: 'not a url', slug: 'x', label: 'y' }]),
		).toThrowError(ValidationError)
		expect(() => loadPlaceRegistry(null)).toThrowError(ValidationError)
	})

	it('maps event id and slug 1:1 and rejects duplicates', () => {
		const reg = loadEventRegistry(events)
		expect(slugForEventId(reg, 'evt_2026_winter')).toBe('winter-retreat-2026')
		expect(slugForEventId(reg, 'evt_missing')).toBeNull()
		expect(() => loadEventRegistry([...events, events[0]])).toThrowError(
			/duplicate event id/,
		)
	})
})
