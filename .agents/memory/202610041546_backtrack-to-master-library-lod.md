# Backtrack: place registry moves to master-library-lod

Date: 2026-10-04
Supersedes: the in-repo `data/vault` place registry from the earlier
session today (nothing was committed; all files were moved out and the
working tree is back to `266ba2e`).

## Decision

The public linked-open-data place registry lives in a new, separate
repository: `../master-library-lod`. Moved there:

- `data/import/places.eml` (Airtable Location export, 200 records)
- `data/import/places-enrichment.json` and `places-curation.json`
- the import pipeline (`master_library.places_import` and its tests),
  now `master_library_lod.places_import`, emitting one Turtle file per
  place under `data/places/` instead of Vault-LD Markdown notes.

Reason: the data is public reference data, not application source; a
data-only repo (Turtle, schema.org-first, persons and places) is
cleaner than parking it under the SvelteKit/oxivault application repo.
The discarded Vault-LD Markdown output was a generated artifact; the
enrichment and curation layers are preserved and reused unchanged.

## Consequences for ADR-0003 (open, needs a decision)

- The place registry (`place_iri` <-> `place_slug`) now has its source
  of truth in master-library-lod. ADR-0003 still assumes the vault on
  R2 is authoritative for catalog notes; either the LOD repo becomes
  the upstream that the vault ingests (rdf2vault), or ADR-0003 needs
  an amendment for the split. Not decided in this session.
- The `nb:` namespace (`https://data.nalandabodhi.org/ontology/`) and
  the data base (`https://data.nalandabodhi.org/`) carry over, so
  identities stay compatible.
- Persons (teachers) are the planned second entity type in the LOD
  repo, linked to places via schema.org event/performer properties;
  no persons source data exists yet.
