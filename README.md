# Master Library

This repository is in a transition from the historical Airtable ingestion and publication worker to the catalog architecture set out in ADR-0001 and ADR-0002.

Status:
- ADR-0001: Proposed. D1-backed editorial catalog with R2 transcript storage and hybrid search.
- ADR-0002: Proposed. Separate development and production delivery accounts with infrastructure-as-code and guarded release promotion.
- The legacy `workers/ingestion` project has been retired from this branch and is treated as historical rather than current operational code.

## Architecture and design records

- [ADR-0001: Use D1 for the video catalog](docs/adr/0001-use-d1-for-video-catalog.md)
- [ADR-0002: Isolate development and production delivery](docs/adr/0002-isolate-dev-and-prod-delivery.md)
- [Design index](.agents/design/index.md)
- [Plan index](.agents/plan/index.md)
- [Review index](.agents/review/index.md)
- [Annotation process sequence](docs/annotation-process-sequence.mermaid)
- [DPR process diagram](docs/dpr_process_complete.mermaid)

## Implementation boundary

The repository is currently split by stack layer.

- `catalog/design` holds the design and retirement boundary for the historical Worker and the new catalog direction.
- `catalog/implementation` is reserved for the ADR-0001 local implementation after the design commit is reviewed and committed.

No deployment, provisioning, or live platform changes are part of this branch state.

## Historical records

The original Airtable-era design and implementation notes remain in the project history for reference:

- [.agents/design/2026-06-07-airtable-control-plane-design.md](.agents/design/2026-06-07-airtable-control-plane-design.md)
- [.agents/design/2026-06-07-ingestion-publication-pipeline-design.md](.agents/design/2026-06-07-ingestion-publication-pipeline-design.md)
- [.agents/plan/2026-06-07-airtable-control-plane.md](.agents/plan/2026-06-07-airtable-control-plane.md)
- [.agents/plan/2026-06-07-ingestion-publication-pipeline.md](.agents/plan/2026-06-07-ingestion-publication-pipeline.md)
- [.agents/review/20260614.md](.agents/review/20260614.md)

## License

This repository is licensed under the project LICENSE file.
