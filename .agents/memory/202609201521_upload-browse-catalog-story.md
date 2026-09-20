# Story: upload and browse catalog, first cut via Cloudflare UI

Status: story drafted, issue blocked.

## Done

- Scaffolded the epic with `tara new epic`:
  `docs/epics/master-library-video-catalog.md` (goal, scope, success metrics,
  story link).
- Scaffolded the story with `tara new story` and filled it:
  `docs/stories/upload-and-browse-catalog.md` (moved off tara's comma-slug
  filename). Librarian uploads videos in the Stream dashboard, verified webhook
  syncs a private draft into D1, browsing via the D1 console. Acceptance
  criteria in GIVEN/WHEN/THEN, tasks, DoD, out of scope aligned with ADR-0001
  (webhook ingress, upsert on `stream_uid`, private drafts).

## Notes

- `tara` is not installed on PATH; ran it as
  `uvx --from /Users/dkapitan/git/plugin-healthcare/tara tara ...` from the
  local checkout (PyPI `tara` is an unrelated stub). If a real global install
  exists, it is not visible to a non-interactive shell.

## Blockers / decisions for the developer

- GitHub issues are disabled on `org-nb/master-library`
  (`hasIssuesEnabled: false`). The issue cannot be created until it is enabled
  (repo Settings > General > Features > Issues) or the developer confirms
  another tracker. Draft issue body below.
- No epic exists yet: created it (see Done) after the story was first drafted.
- `tara` CLI is not installed; the story was scaffolded by hand following the
  skill format.

## Draft GitHub issue

Title: Upload new videos and browse the catalog (first implementation via Cloudflare UI)

Body:

> ## Story
>
> As a librarian, I want to upload new videos through the Cloudflare Stream
> dashboard and browse the resulting catalog, so that new teachings become part
> of the Master Library without custom tooling.
>
> Epic: Master Library catalog (see ADR-0001).
>
> ## Background
>
> First implementation of the D1 video catalog from ADR-0001. No editor UI or
> editorial API yet, so the librarian works directly in the Cloudflare
> dashboards for this first cut:
>
> - Upload and metadata entry happen in the Stream dashboard. Metadata travels
>   as Stream custom metadata set at upload time.
> - Upload completion triggers the Stream webhook. The catalog worker verifies
>   it and syncs a record into D1; new uploads import as private drafts (status
>   `draft`, visibility `private`).
> - Browsing happens through the D1 query interface in the Cloudflare dashboard.
>
> Known limitation: Stream webhooks fire on processing completion or error, not
> on later metadata edits. Metadata changes after upload are covered by the
> scheduled reconciliation in ADR-0001 and are out of scope here.
>
> ## Acceptance criteria
>
> 1. **Upload syncs to the catalog** - GIVEN a librarian with access to the
>    Stream dashboard on the dev delivery account, WHEN they upload a video and
>    provide its metadata (title, description, language) in the Stream
>    dashboard, THEN the verified upload event creates a catalog record in the
>    D1 `videos` table with status `draft`, visibility `private`, and the
>    provided metadata.
> 2. **Replays do not duplicate** - GIVEN the same upload event is delivered
>    more than once, WHEN the catalog worker processes it, THEN the existing
>    record is updated in place (revision bumped) and no duplicate row is
>    created.
> 3. **Browsing the catalog** - GIVEN catalog records in the D1 database, WHEN a
>    librarian opens the D1 query interface and runs a query against `videos`,
>    THEN they can browse the uploaded videos with their metadata, status, and
>    visibility.
>
> ## Definition of done
>
> - Worker tests cover webhook verification and the D1 upsert; worker gate
>   (biome, vitest) and repo gate (`tara check`) pass.
> - Live qualification on the dev account: a Stream UI upload creates exactly
>   one D1 record and it is browsable in the D1 console.
> - Operating procedure for upload and browse documented in worker docs or
>   README; changelog updated if user-facing.
> - No secrets or local config staged; developer reviews and commits.
>
> Full story: `docs/stories/upload-and-browse-catalog.md`.
