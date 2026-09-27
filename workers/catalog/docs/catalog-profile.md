# Catalog Profile: Minimal BBC Programmes Mapping

This document pins the exact ontology terms, reviewed snapshot references, and relational mappings used by the Master Library catalog, as agreed in [ADR-0001](../../../docs/adr/0001-use-d1-for-video-catalog.md).

## Referenced Ontologies and Attribution

- **BBC Programmes Ontology (`po:`)**: Version 1.1 snapshot (hosted by IPTC at `http://purl.org/ontology/po/`).
- **Core Concepts Ontology (`core:`)**: BBC Core Concepts Ontology.
- **FOAF (`foaf:`)**: Friend of a Friend vocabulary (`http://xmlns.com/foaf/0.1/`).
- **Dublin Core Metadata Terms (`dcterms:`)**: Dublin Core (`http://purl.org/dc/terms/`).
- **Attribution & Licensing**: Materials derived from BBC ontologies are licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) license.

## Relational Profile Mapping

The Master Library uses a relational application profile mapped directly to SQLite / Cloudflare D1 tables. It does not introduce a triplestore, SPARQL endpoint, or runtime RDF dependencies.

| Catalog Concept | Vocabulary Term URI | Relational Target | Semantic Invariants |
| --- | --- | --- | --- |
| Logical Teaching Video | `po:Episode` (`http://purl.org/ontology/po/Episode`) | `videos` | Identifies a distinct, completed pedagogical teaching item. Can exist standalone without a series. |
| Teaching / Course Group | `po:Series` (`http://purl.org/ontology/po/Series`) | `series` | Groups episodes into courses or retreat lecture series via `videos.series_id` and positive `videos.position`. |
| Content Edition / Timeline | `po:Version` (`http://purl.org/ontology/po/Version`) | `video_versions` | Defines an authoritative cut/edit and audio timeline (`po:duration`). One episode can have multiple versions. |
| Title & Synopsis | `dcterms:title`, `po:synopsis` | `videos.title`, `videos.description` | Stored directly on the episode entity; no duplicate generic creative work records. |
| Speaker / Teacher | `foaf:Person` (`http://xmlns.com/foaf/0.1/Person`) | `people` | Represents a person. Contributor links (`video_contributors`) associate person with an episode with a local role (`teacher`, `translator`, etc.). Contributor is not author or subject. |
| Subject / Topic | `po:Subject` (`http://purl.org/ontology/po/Subject`) | `topics` & `video_topics` | Topics/taxonomies linked to episodes via `video_topics` (`po:subject`). Distinct from contributors. |
| Backend Copy / Locator | *Local Extension* | `storage_locations`, `video_assets`, `asset_playback_entries` | Physical storage, packages, file formats, and playback locators are local operational extensions outside BBC ontology terms. |

## Identity Hierarchy

```text
videos (po:Episode)
  └── video_versions (po:Version)
        └── video_assets [local extension] (storage_location + external_id)
              └── asset_playback_entries [local extension] (protocol: mp4 | hls | dash)
```

1. **`videos`**: Stable logical identity for human discovery and catalog indexing.
2. **`video_versions`**: Exact editorial edit/timeline, defining duration and transcript anchors.
3. **`video_assets`**: Concrete file or managed package living in R2, Stream, or S3.
