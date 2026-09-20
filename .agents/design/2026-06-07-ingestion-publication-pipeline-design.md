# Ingestion And Publication Pipeline Design

**Project:** Master Library
**Date:** 2026-06-07
**Status:** Approved in chat

## Goal

Define the MVP ingestion and publication pipeline that moves a single primary source video from Cloudflare R2 into Cloudflare Stream, writes operational state back to Airtable, and emits a downstream indexing handoff once the video is ready to stream.

## Architecture

Use a state-driven hybrid pipeline implemented as a single Cloudflare Worker project written in Python 3.13.

- Airtable remains the operator-visible control plane
- Cloudflare R2 stores the single primary source asset for the MVP
- Cloudflare Stream imports from an R2-backed URL and becomes the authority for playback readiness
- Cloudflare Workers Python runtime handles orchestration, webhook processing, and reconciliation
- Downstream indexing is out of scope for this spec, but the pipeline must define a handoff contract when a video reaches `ready_to_stream`

This approach keeps the workflow explicit and operationally robust while staying fully on Cloudflare and avoiding a separate always-on backend.

## Components And Responsibilities

### Python Worker Runtime

- one Cloudflare Worker project written in Python 3.13
- one `fetch` handler for Stream webhooks and optional health/debug endpoints
- one `scheduled` handler that runs:
  - ingest trigger scans
  - reconciliation scans

### `trigger_job`

- runs on a schedule or targeted trigger
- finds Airtable `Video` records in `ready_for_ingest`
- validates that exactly one primary R2 source asset is present
- claims work idempotently so the same video is not launched twice
- moves the `Video` to `ingesting`

### `publication_flow`

- implemented inside the Python Worker runtime
- requests Cloudflare Stream import from the R2 URL
- writes back `cloudflare_uid` and initial publication metadata
- moves the `Video` to `processing`

### `webhook_handler`

- public `fetch` route for Cloudflare Stream webhooks
- verifies webhook authenticity
- updates Airtable on success or failure
- writes playback and reference fields
- marks `ready_to_stream` or `error`

### `reconciliation_job`

- scheduled Python Worker job
- periodically checks records stuck in `ingesting` or `processing`
- queries Stream state directly
- repairs missed webhook or failed write-back cases

### Supporting Modules

- `config`
  - reads Worker environment bindings and secrets
- `airtable_client`
  - reads and updates `Video` records and linked asset data
- `stream_client`
  - creates Stream imports and interprets Stream status and webhook payloads
- `state_machine`
  - owns allowed state transitions
- `eligibility`
  - validates whether a record is actually ingestable
- `handoff`
  - emits the downstream indexing contract only after `ready_to_stream`

## State Model

Use this `Video` lifecycle for the MVP:

- `draft`
  - default editorial state
  - not eligible for automation

- `ready_for_ingest`
  - explicit go signal from Airtable
  - requires one primary R2 source asset and required metadata

- `ingesting`
  - `trigger_job` has claimed the record
  - validation passed and the publication flow has started

- `processing`
  - Cloudflare Stream accepted the import
  - `cloudflare_uid` is known
  - waiting for Stream readiness or failure

- `ready_to_stream`
  - Stream webhook or reconciliation confirmed streamability
  - playback and reference URLs are written back to Airtable
  - downstream indexing handoff can now be emitted

- `error`
  - validation failed, import failed, processing failed, or reconciliation found an unrecoverable mismatch
  - manual retry happens outside Airtable for the MVP

## Data Flow

### Normal Flow

1. Librarian marks `Video` as `ready_for_ingest`
2. The Worker `scheduled` handler runs `trigger_job`
3. `trigger_job` validates the Airtable record and linked R2 asset
4. The Worker claims the record and moves it to `ingesting`
5. `publication_flow` requests Stream import from the R2 URL
6. Airtable is updated with `cloudflare_uid` and `processing`
7. The Worker `fetch` handler receives the Stream webhook event
8. `webhook_handler` writes playback fields and marks `ready_to_stream` or `error`
9. A lightweight handoff event is emitted for downstream indexing

### Recovery Flow

- the Worker `scheduled` handler also runs `reconciliation_job`
- if Airtable state and Stream state disagree, reconciliation corrects Airtable
- if webhook delivery was missed, reconciliation can still advance the record to `ready_to_stream`
- if a record is stuck too long, reconciliation marks `error` with a short reason

## System Boundaries

### Airtable

- source of truth for operator-visible workflow state
- explicit entry point through `ready_for_ingest`
- stores `cloudflare_uid`, readiness state, playback URLs, and short operational errors

### Cloudflare R2

- stores the single primary source object for the MVP
- provides the importable source URL used by Stream

### Cloudflare Stream

- imports from the R2 URL
- processes and serves video
- emits webhook events
- remains authoritative for actual playback readiness

### Cloudflare Workers Python Runtime

- owns orchestration, publication initiation, webhook handling, and reconciliation
- stays fully within Cloudflare hosting for the MVP
- interacts with Airtable and Stream strictly over HTTP APIs
- repairs Airtable state from Stream facts when needed

## Error Handling And Operational Guarantees

### Validation Failures Before Import

- if the `Video` is marked `ready_for_ingest` but required metadata is missing, mark `error`
- if there is not exactly one primary R2 source asset, mark `error`
- write a short Airtable error summary such as `missing primary source asset` or `missing slug`

### Import And Processing Failures

- if Stream rejects the import request, mark `error`
- if Stream later reports processing failure, mark `error`
- keep raw provider payloads out of Airtable; store only a short operator-facing summary there

### Webhook And Reconciliation Behavior

- treat the webhook as the primary readiness signal
- treat reconciliation as repair, not a second independent workflow
- reconciliation can:
  - advance a record to `ready_to_stream` if webhook delivery was missed
  - keep a record in `processing` if Stream is still working
  - mark `error` if the record is stuck beyond a defined timeout or Stream reports failure

### Idempotency Rules

- claiming `ready_for_ingest` must be safe to retry
- publishing the same `Video` twice should be prevented by checking existing `cloudflare_uid` and current state
- webhook processing must tolerate duplicate delivery
- reconciliation must only make corrective transitions that are valid from current Airtable and Stream facts

### Python Runtime Constraints

- prefer standard-library HTTP and JSON handling where practical, or very small Worker-compatible dependencies
- keep request construction explicit and testable
- avoid heavyweight frameworks that assume a long-running Python server process
- keep business rules pure so most tests do not depend on the Worker runtime itself

## Downstream Handoff Contract

This spec stops short of implementing indexing logic, but it defines the handoff boundary.

The pipeline may emit a downstream event or invoke a downstream worker only after all of the following are true:

- Airtable state is `ready_to_stream`
- `cloudflare_uid` is present
- primary playback/reference URLs have been written back

The emitted handoff payload should contain at least:

- Airtable record ID
- video slug
- `cloudflare_uid`
- `ready_to_stream` timestamp
- current publication status

## Testing Strategy

- unit tests for eligibility validation
- unit tests for state transition rules
- unit tests for webhook payload interpretation
- unit tests for reconciliation decisions
- contract tests confirming the indexing handoff only emits after `ready_to_stream`
- small integration-style tests for Airtable and Stream request construction
- one Worker-level test for the `scheduled` trigger path
- one Worker-level test for the `fetch` webhook path

## Success Criterion

- a librarian can open a `Video` record and understand whether the video is waiting, processing, ready, or failed
- the system can recover from duplicate events and missed webhooks without manual database repair
- the pipeline produces a clean, explicit handoff point for downstream indexing
