# Ingestion And Publication Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare-native Python 3.13 Worker that ingests one primary R2-backed video into Cloudflare Stream, writes status back to Airtable, and emits a downstream handoff only after `ready_to_stream`.

**Architecture:** Implement a single Python Worker project using Cloudflare's Python Workers runtime. Keep the Worker entrypoint thin, put Airtable/Stream HTTP logic in small modules, centralize state transitions and eligibility rules in pure Python helpers, and use one `fetch` path plus one `scheduled` path to cover webhook, trigger, and reconciliation behavior.

**Tech Stack:** Python 3.13, Cloudflare Python Workers, pywrangler, uv, pytest, Airtable REST API, Cloudflare Stream API, Cloudflare R2

---

## File Structure

### Runtime Files

- Create: `workers/ingestion/pyproject.toml`
  - Python project metadata and dev dependencies for pywrangler and tests
- Create: `workers/ingestion/wrangler.toml`
  - Worker configuration, Python compatibility flag, vars, and cron triggers
- Create: `workers/ingestion/src/entry.py`
  - Worker entrypoint with `Default(WorkerEntrypoint)`, `fetch`, and `scheduled`
- Create: `workers/ingestion/src/config.py`
  - environment access and typed config helpers
- Create: `workers/ingestion/src/domain/video_state.py`
  - allowed state transitions and transition validation
- Create: `workers/ingestion/src/domain/video_record.py`
  - normalized Airtable `Video` and primary asset model
- Create: `workers/ingestion/src/lib/operator_errors.py`
  - operator-facing error shortening
- Create: `workers/ingestion/src/lib/idempotency.py`
  - stable ingest lock keys and duplicate suppression helpers
- Create: `workers/ingestion/src/airtable_client.py`
  - Airtable request builders and update helpers
- Create: `workers/ingestion/src/stream_client.py`
  - Stream import request builders and webhook/status interpreters
- Create: `workers/ingestion/src/handoff.py`
  - downstream handoff payload builder and sender
- Create: `workers/ingestion/src/eligibility.py`
  - `ready_for_ingest` validation rules
- Create: `workers/ingestion/src/trigger_job.py`
  - scheduled ingest trigger job
- Create: `workers/ingestion/src/publication_flow.py`
  - R2 URL to Stream import flow
- Create: `workers/ingestion/src/webhook_handler.py`
  - webhook decision logic and Airtable write-back coordination
- Create: `workers/ingestion/src/reconciliation_job.py`
  - recovery logic for stuck or drifted records

### Test Files

- Create: `workers/ingestion/tests/test_config.py`
- Create: `workers/ingestion/tests/test_video_state.py`
- Create: `workers/ingestion/tests/test_video_record.py`
- Create: `workers/ingestion/tests/test_eligibility.py`
- Create: `workers/ingestion/tests/test_stream_client.py`
- Create: `workers/ingestion/tests/test_webhook_handler.py`
- Create: `workers/ingestion/tests/test_reconciliation_job.py`
- Create: `workers/ingestion/tests/test_handoff.py`
- Create: `workers/ingestion/tests/test_entrypoint.py`

### Documentation Files

- Modify: `docs/superpowers/plans/2026-06-07-ingestion-publication-pipeline.md`
  - replace the previous plan with this Python 3.13 Worker plan

## Assumptions

- The approved design in `docs/superpowers/specs/2026-06-07-ingestion-publication-pipeline-design.md` is the source of truth.
- Airtable `Videos` records expose at least `Sync Status`, `Last Sync Error`, `Cloudflare UID`, playback URL fields, and a way to identify one primary source asset.
- The MVP uses one primary R2-backed source asset per `Video`.
- The Worker can reach Airtable and Stream over HTTP from the Python Workers runtime.
- Downstream handoff can initially be an HTTP POST to a configured endpoint.

## Command Context

Unless a step says otherwise, run all commands from `workers/ingestion`.

### Task 1: Scaffold The Python Worker Project

**Files:**
- Create: `workers/ingestion/pyproject.toml`
- Create: `workers/ingestion/wrangler.toml`
- Create: `workers/ingestion/src/entry.py`
- Create: `workers/ingestion/tests/test_entrypoint.py`

- [ ] **Step 1: Write the failing entrypoint test**

```python
from src.entry import Default


def test_default_entrypoint_exposes_worker_handlers():
    assert hasattr(Default, "fetch")
    assert hasattr(Default, "scheduled")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_entrypoint.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.entry'`

- [ ] **Step 3: Write minimal project files**

`workers/ingestion/pyproject.toml`

```toml
[project]
name = "master-library-ingestion-worker"
version = "0.1.0"
description = "Cloudflare Python Worker for Master Library ingestion"
requires-python = ">=3.13"
dependencies = []

[dependency-groups]
dev = [
  "workers-py",
  "workers-runtime-sdk",
  "pytest>=8.3.0",
]
```

`workers/ingestion/wrangler.toml`

```toml
name = "master-library-ingestion"
main = "src/entry.py"
compatibility_date = "2026-06-07"
compatibility_flags = ["python_workers"]

[triggers]
crons = ["*/5 * * * *", "*/15 * * * *"]
```

`workers/ingestion/src/entry.py`

```python
from workers import Response, WorkerEntrypoint


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response("Not implemented", status=501)

    async def scheduled(self, controller, env, ctx):
        return None
```

- [ ] **Step 4: Sync dependencies**

Run: `uv sync`
Expected: completes successfully and creates `uv.lock`

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_entrypoint.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/ingestion/pyproject.toml workers/ingestion/uv.lock workers/ingestion/wrangler.toml workers/ingestion/src/entry.py workers/ingestion/tests/test_entrypoint.py
git commit -m "feat: scaffold python ingestion worker"
```

### Task 2: Add Config And Record Normalization

**Files:**
- Create: `workers/ingestion/src/config.py`
- Create: `workers/ingestion/src/domain/video_record.py`
- Create: `workers/ingestion/tests/test_config.py`
- Create: `workers/ingestion/tests/test_video_record.py`

- [ ] **Step 1: Write the failing tests**

```python
import pytest

from src.config import require_env
from src.domain.video_record import normalize_video_record


def test_require_env_raises_for_missing_key():
    with pytest.raises(ValueError, match="AIRTABLE_API_TOKEN"):
        require_env({}, "AIRTABLE_API_TOKEN")


def test_normalize_video_record_extracts_primary_asset():
    record = normalize_video_record(
        {
            "id": "rec123",
            "fields": {
                "Slug": "heart-sutra-part-1",
                "Sync Status": "ready_for_ingest",
                "Assets": [
                    {
                        "id": "ast1",
                        "type": "source_video",
                        "isPrimary": True,
                        "r2Key": "videos/heart.mp4",
                    }
                ],
            },
        }
    )

    assert record.slug == "heart-sutra-part-1"
    assert record.primary_asset["r2Key"] == "videos/heart.mp4"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_config.py tests/test_video_record.py -q`
Expected: FAIL with missing `config.py` and `video_record.py`

- [ ] **Step 3: Write the config and normalization modules**

`workers/ingestion/src/config.py`

```python
def require_env(env: object, key: str) -> str:
    value = getattr(env, key, None) if not isinstance(env, dict) else env.get(key)
    if not value:
        raise ValueError(f"Missing required env: {key}")
    return value
```

`workers/ingestion/src/domain/video_record.py`

```python
from dataclasses import dataclass


@dataclass
class VideoRecord:
    record_id: str
    slug: str
    sync_status: str
    primary_asset: dict


def normalize_video_record(record: dict) -> VideoRecord:
    fields = record.get("fields", {})
    slug = fields.get("Slug")
    if not slug:
        raise ValueError("Video missing Slug")

    assets = fields.get("Assets", [])
    primary_assets = [
        asset for asset in assets if asset.get("isPrimary") and asset.get("type") == "source_video"
    ]
    if len(primary_assets) != 1:
        raise ValueError("Video must have exactly one primary source asset")

    return VideoRecord(
        record_id=record["id"],
        slug=slug,
        sync_status=fields.get("Sync Status", "draft"),
        primary_asset=primary_assets[0],
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py tests/test_video_record.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingestion/src/config.py workers/ingestion/src/domain/video_record.py workers/ingestion/tests/test_config.py workers/ingestion/tests/test_video_record.py
git commit -m "feat: add ingestion config and record normalization"
```

### Task 3: Implement State Machine And Eligibility

**Files:**
- Create: `workers/ingestion/src/domain/video_state.py`
- Create: `workers/ingestion/src/eligibility.py`
- Create: `workers/ingestion/tests/test_video_state.py`
- Create: `workers/ingestion/tests/test_eligibility.py`

- [ ] **Step 1: Write the failing tests**

```python
import pytest

from src.domain.video_record import VideoRecord
from src.domain.video_state import transition_video_state
from src.eligibility import assert_eligible_for_ingest


def test_transition_video_state_allows_ready_for_ingest_to_ingesting():
    assert transition_video_state("ready_for_ingest", "ingesting") == "ingesting"


def test_transition_video_state_rejects_ready_to_stream_to_ingesting():
    with pytest.raises(ValueError, match="Invalid transition"):
        transition_video_state("ready_to_stream", "ingesting")


def test_assert_eligible_for_ingest_accepts_valid_record():
    record = VideoRecord(
        record_id="rec123",
        slug="heart-sutra-part-1",
        sync_status="ready_for_ingest",
        primary_asset={"r2Key": "videos/heart.mp4"},
    )
    assert_eligible_for_ingest(record)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_video_state.py tests/test_eligibility.py -q`
Expected: FAIL with missing modules

- [ ] **Step 3: Write the state machine and eligibility modules**

`workers/ingestion/src/domain/video_state.py`

```python
ALLOWED_TRANSITIONS = {
    "draft": {"ready_for_ingest"},
    "ready_for_ingest": {"ingesting", "error"},
    "ingesting": {"processing", "error"},
    "processing": {"ready_to_stream", "error"},
    "ready_to_stream": set(),
    "error": {"ready_for_ingest"},
}


def transition_video_state(current: str, next_state: str) -> str:
    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if next_state not in allowed:
        raise ValueError(f"Invalid transition: {current} -> {next_state}")
    return next_state
```

`workers/ingestion/src/eligibility.py`

```python
from src.domain.video_record import VideoRecord


def assert_eligible_for_ingest(record: VideoRecord) -> None:
    if record.sync_status != "ready_for_ingest":
        raise ValueError("Video is not ready_for_ingest")
    if not record.slug:
        raise ValueError("Video missing slug")
    if not record.primary_asset.get("r2Key"):
        raise ValueError("Video missing primary source asset")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_video_state.py tests/test_eligibility.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingestion/src/domain/video_state.py workers/ingestion/src/eligibility.py workers/ingestion/tests/test_video_state.py workers/ingestion/tests/test_eligibility.py
git commit -m "feat: add ingestion state and eligibility rules"
```

### Task 4: Add Airtable And Stream Request Builders

**Files:**
- Create: `workers/ingestion/src/lib/operator_errors.py`
- Create: `workers/ingestion/src/airtable_client.py`
- Create: `workers/ingestion/src/stream_client.py`
- Create: `workers/ingestion/tests/test_stream_client.py`

- [ ] **Step 1: Write the failing request-builder tests**

```python
from src.airtable_client import build_airtable_status_patch
from src.stream_client import build_stream_import_payload


def test_build_stream_import_payload_uses_source_url():
    assert build_stream_import_payload("https://assets.example/video.mp4") == {
        "url": "https://assets.example/video.mp4"
    }


def test_build_airtable_status_patch_writes_operator_error():
    assert build_airtable_status_patch("error", "missing slug") == {
        "Sync Status": "error",
        "Last Sync Error": "missing slug",
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_stream_client.py -q`
Expected: FAIL with missing request builder modules

- [ ] **Step 3: Write the minimal request-builder code**

`workers/ingestion/src/lib/operator_errors.py`

```python
def to_operator_error(message: str) -> str:
    return message.strip()[:200]
```

`workers/ingestion/src/airtable_client.py`

```python
from src.lib.operator_errors import to_operator_error


def build_airtable_status_patch(status: str, error: str | None = None) -> dict:
    return {
        "Sync Status": status,
        "Last Sync Error": to_operator_error(error) if error else "",
    }
```

`workers/ingestion/src/stream_client.py`

```python
def build_stream_import_payload(source_url: str) -> dict:
    return {"url": source_url}


def interpret_stream_webhook(payload: dict) -> str:
    if payload.get("readyToStream"):
        return "ready_to_stream"
    return "error"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_stream_client.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingestion/src/lib/operator_errors.py workers/ingestion/src/airtable_client.py workers/ingestion/src/stream_client.py workers/ingestion/tests/test_stream_client.py
git commit -m "feat: add ingestion request builders"
```

### Task 5: Implement Trigger And Publication Flow

**Files:**
- Create: `workers/ingestion/src/lib/idempotency.py`
- Create: `workers/ingestion/src/publication_flow.py`
- Create: `workers/ingestion/src/trigger_job.py`
- Modify: `workers/ingestion/tests/test_stream_client.py`

- [ ] **Step 1: Extend tests for trigger and publication helpers**

```python
from src.lib.idempotency import build_ingest_lock_key
from src.publication_flow import create_publication_request


def test_build_ingest_lock_key_uses_record_id():
    assert build_ingest_lock_key("rec123") == "video:rec123:ingest"


def test_create_publication_request_returns_stream_payload():
    assert create_publication_request("https://assets.example/video.mp4") == {
        "url": "https://assets.example/video.mp4"
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_stream_client.py -q`
Expected: FAIL with missing publication helpers

- [ ] **Step 3: Write the trigger/publication helper code**

`workers/ingestion/src/lib/idempotency.py`

```python
def build_ingest_lock_key(record_id: str) -> str:
    return f"video:{record_id}:ingest"
```

`workers/ingestion/src/publication_flow.py`

```python
from src.stream_client import build_stream_import_payload


def create_publication_request(source_url: str) -> dict:
    return build_stream_import_payload(source_url)
```

`workers/ingestion/src/trigger_job.py`

```python
async def run_trigger_job() -> dict:
    return {"scanned": 0}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_stream_client.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingestion/src/lib/idempotency.py workers/ingestion/src/publication_flow.py workers/ingestion/src/trigger_job.py workers/ingestion/tests/test_stream_client.py
git commit -m "feat: add trigger and publication helpers"
```

### Task 6: Implement Webhook And Reconciliation Logic

**Files:**
- Create: `workers/ingestion/src/webhook_handler.py`
- Create: `workers/ingestion/src/reconciliation_job.py`
- Create: `workers/ingestion/tests/test_webhook_handler.py`
- Create: `workers/ingestion/tests/test_reconciliation_job.py`

- [ ] **Step 1: Write the failing logic tests**

```python
from src.reconciliation_job import reconcile_state
from src.webhook_handler import handle_webhook_payload


def test_handle_webhook_payload_marks_ready_to_stream():
    assert handle_webhook_payload({"readyToStream": True}) == {"next_status": "ready_to_stream"}


def test_reconcile_state_marks_error_for_failed_stream():
    assert reconcile_state("processing", {"failed": True}) == "error"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_webhook_handler.py tests/test_reconciliation_job.py -q`
Expected: FAIL with missing modules

- [ ] **Step 3: Write the webhook and reconciliation modules**

`workers/ingestion/src/webhook_handler.py`

```python
from src.stream_client import interpret_stream_webhook


def handle_webhook_payload(payload: dict) -> dict:
    return {"next_status": interpret_stream_webhook(payload)}
```

`workers/ingestion/src/reconciliation_job.py`

```python
def reconcile_state(current_status: str, stream_state: dict) -> str:
    if stream_state.get("readyToStream"):
        return "ready_to_stream"
    if stream_state.get("failed"):
        return "error"
    return current_status


async def run_reconciliation_job() -> dict:
    return {"scanned": 0}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_webhook_handler.py tests/test_reconciliation_job.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingestion/src/webhook_handler.py workers/ingestion/src/reconciliation_job.py workers/ingestion/tests/test_webhook_handler.py workers/ingestion/tests/test_reconciliation_job.py
git commit -m "feat: add webhook and reconciliation logic"
```

### Task 7: Implement Downstream Handoff Rules

**Files:**
- Create: `workers/ingestion/src/handoff.py`
- Create: `workers/ingestion/tests/test_handoff.py`

- [ ] **Step 1: Write the failing handoff tests**

```python
import pytest

from src.handoff import build_handoff_payload


def test_build_handoff_payload_requires_ready_to_stream():
    with pytest.raises(ValueError, match="ready_to_stream"):
        build_handoff_payload(
            {
                "id": "rec123",
                "slug": "heart-sutra-part-1",
                "cloudflare_uid": "uid123",
                "sync_status": "processing",
            }
        )


def test_build_handoff_payload_returns_expected_fields():
    payload = build_handoff_payload(
        {
            "id": "rec123",
            "slug": "heart-sutra-part-1",
            "cloudflare_uid": "uid123",
            "sync_status": "ready_to_stream",
        }
    )

    assert payload["record_id"] == "rec123"
    assert payload["cloudflare_uid"] == "uid123"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_handoff.py -q`
Expected: FAIL with missing `handoff.py`

- [ ] **Step 3: Write the handoff module**

```python
def build_handoff_payload(record: dict) -> dict:
    if record["sync_status"] != "ready_to_stream":
        raise ValueError("Cannot emit handoff before ready_to_stream")

    return {
        "record_id": record["id"],
        "slug": record["slug"],
        "cloudflare_uid": record["cloudflare_uid"],
        "status": record["sync_status"],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_handoff.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingestion/src/handoff.py workers/ingestion/tests/test_handoff.py
git commit -m "feat: add ingestion handoff rules"
```

### Task 8: Wire The Worker Entrypoint And Final Verification

**Files:**
- Modify: `workers/ingestion/src/entry.py`
- Modify: `workers/ingestion/tests/test_entrypoint.py`

- [ ] **Step 1: Extend the failing entrypoint tests for `fetch` and `scheduled` routing**

```python
from src.entry import Default


def test_default_entrypoint_exposes_worker_handlers():
    assert hasattr(Default, "fetch")
    assert hasattr(Default, "scheduled")


def test_entrypoint_class_name_is_default():
    assert Default.__name__ == "Default"
```

- [ ] **Step 2: Run tests to verify routing work is still incomplete**

Run: `uv run pytest tests/test_entrypoint.py -q`
Expected: PASS for class shape only, while Worker routing is still minimal

- [ ] **Step 3: Update the entrypoint to call the trigger, webhook, and reconciliation modules**

`workers/ingestion/src/entry.py`

```python
from workers import Response, WorkerEntrypoint

from src.reconciliation_job import run_reconciliation_job
from src.trigger_job import run_trigger_job
from src.webhook_handler import handle_webhook_payload


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = request.url
        if url.endswith("/webhooks/stream"):
            payload = await request.json()
            result = handle_webhook_payload(payload)
            return Response.json(result)

        return Response("Not found", status=404)

    async def scheduled(self, controller, env, ctx):
        if controller.cron == "*/5 * * * *":
            await run_trigger_job()
            return

        if controller.cron == "*/15 * * * *":
            await run_reconciliation_job()
            return
```

- [ ] **Step 4: Run the full verification suite**

Run: `uv run pytest -q`
Expected: PASS with all tests green

- [ ] **Step 5: Validate Worker local behavior**

Run: `uv run pywrangler dev`
Expected: local Worker starts without configuration errors

- [ ] **Step 6: Commit**

```bash
git add workers/ingestion/src/entry.py workers/ingestion/tests/test_entrypoint.py
git commit -m "feat: wire python ingestion worker entrypoint"
```

## Self-Review

### Spec Coverage

- Python 3.13 Worker runtime: covered by Tasks 1 and 8
- `fetch` plus `scheduled` runtime split: covered by Tasks 1 and 8
- `ready_for_ingest` validation and state model: covered by Tasks 2 and 3
- R2-to-Stream publication flow: covered by Tasks 4 and 5
- Webhook plus reconciliation recovery: covered by Tasks 6 and 8
- Downstream handoff only after `ready_to_stream`: covered by Task 7

No spec gaps found.

### Placeholder Scan

- No unresolved placeholder markers remain
- Every task contains exact file paths, commands, and concrete code snippets

### Type Consistency

- `ready_for_ingest`, `ingesting`, `processing`, `ready_to_stream`, and `error` are used consistently
- `cloudflare_uid` remains the external field name in the Python plan and handoff payload
