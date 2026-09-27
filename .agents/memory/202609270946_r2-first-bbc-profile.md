# R2-first and BBC profile handoff

User confirmed a minimal BBC Programmes profile and R2-first sequence after
reviewing the BBC/IPTC and MovieLabs OMC sources. ADR-0001 now maps episode,
edition, series, contributors and subjects to a small relational profile.
Provider assets are local extensions. No graph runtime, generic entity model
or OMC AssetSC hierarchy is required.

Kept video -> edition -> backend assets. Replaced exclusive source/playback
roles with independent `is_source`/`playback_enabled` flags, so one validated
original MP4 can do both jobs. Source hashes belong to assets. Use series and
people/contributor links, not duplicate teaching-work/teacher tables.

The implementation plan now completes schema cutover before R2 ingest,
delivers protected MP4 first, then HLS, supplied transcripts/search and optional
Stream/S3. Stream qualification is not a migration or first-release dependency.
Aligned the story, epic, README, cost comparison and delivery profile guidance.
The ingest story now needs a small authenticated operator tool, not only the
Stream dashboard; trusted operator identity remains an activation prerequisite.

Only design/planning documentation changed. Existing staged work was preserved.
Local links, profile term references and sequence consistency were reviewed;
runtime tests and live qualification remain future implementation work.
No schema, application code or infrastructure was changed or deployed.

Suggested commit message:
`docs: make catalog R2-first with a minimal BBC ontology profile`
