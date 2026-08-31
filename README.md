# Master Library - Ingestion & Publication Pipeline

As part of an ongoing effort to make recordings of teachings available to a wide audience, we share the source code of the digital Master Library platform that is in the making. We do so with the intention of supporting similar initatives such that they can readily deploy their own digital library. The work is licensed under the terms specified in the LICENSE file of each repository.

> **Cloudflare Python Worker for Video Ingestion and Stream Processing**

A production-ready Python 3.13 Cloudflare Worker that automates the ingestion of R2-backed videos into Cloudflare Stream, with status synchronization to Airtable and downstream handoff capabilities.

---

## Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Features](#-features)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [Deployment](#-deployment)
  - [Local Development](#local-development)
  - [Cloudflare Deployment](#cloudflare-deployment)
- [Testing](#-testing)
- [How It Works](#-how-it-works)
- [API Reference](#-api-reference)
- [Contributing](#-contributing)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## Overview

The **Master Library Ingestion Pipeline** is a serverless video processing system built on Cloudflare's Python Workers platform. It provides automated ingestion of video assets from R2 storage into Cloudflare Stream, with real-time status tracking in Airtable and webhook-based handoff to downstream systems.

### Key Capabilities

- **Automated Video Ingestion**: Scans Airtable for videos ready for processing
- **R2 to Stream Pipeline**: Converts R2-hosted videos to Cloudflare Stream imports
- **Status Synchronization**: Real-time updates to Airtable records
- **Webhook Processing**: Handles Cloudflare Stream webhook events
- **Reconciliation**: Automatic recovery for stuck or failed records
- **Idempotent Operations**: Safe retry logic for all operations

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers Platform                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐  │
│  │   fetch()       │    │  scheduled()    │    │  Webhooks   │  │
│  │   - Webhook     │    │  - Trigger Job  │    │  - Stream   │  │
│  │     Handler     │    │    (5-min cron  │    │    Events   │  │
│  └────────┬────────┘    └────────┬────────┘    └──────┬──────┘  │
│           │                      │                    │         │
│           ▼                      ▼                    ▼         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Ingestion Worker                        │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────────┐  │ │
│  │  │  webhook_   │  │ trigger_    │  │ reconciliation_    │  │ │
│  │  │  handler.py │  │ job.py      │  │ job.py             │  │ │
│  │  └─────────────┘  └─────────────┘  └────────────────────┘  │ │
│  │                                                            │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐  │ │
│  │  │ publication_    │  │ airtable_       │  │ stream_    │  │ │
│  │  │ flow.py         │  │ client.py       │  │ client.py  │  │ │
│  │  └─────────────────┘  └─────────────────┘  └────────────┘  │ │
│  │                                                            │ │
│  │  ┌─────────────────┐  ┌─────────────────┐                  │ │
│  │  │ config.py       │  │ domain/         │                  │ │
│  │  └─────────────────┘  │   ├── video_    │                  │ │
│  │                       │   │   record.py │                  │ │
│  │                       │   └─────────────┘                  │ │
│  │                       │   ├── video_    │                  │ │
│  │                       │   │   state.py  │                  │ │
│  │                       └─────────────────┘                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
     │                           │                           │
     ▼                           ▼                           ▼
┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Airtable  │    │  Cloudflare R2  │    │ Cloudflare      │
│  (Videos    │    │  (Video Assets) │    │ Stream          │
│   Table)    │    └─────────────────┘    └─────────────────┘
└─────────────┘           │                          │
                          │ Stream Import            │ Webhooks
                          ▼                          ▼
                    ┌─────────────────┐
                    │  Downstream     │
                    │  Systems        │
                    └─────────────────┘
```

### Component Overview

| Component | Purpose | Trigger |
|-----------|---------|---------|
| `entry.py` | Worker entrypoint | HTTP requests & cron |
| `webhook_handler.py` | Process Stream webhooks | HTTP POST |
| `trigger_job.py` | Find & process eligible videos | 5-min cron |
| `reconciliation_job.py` | Recover stuck records | 15-min cron |
| `publication_flow.py` | R2 → Stream import flow | Internal |
| `airtable_client.py` | Airtable API operations | Internal |
| `stream_client.py` | Stream API operations | Internal |

---

## Features

### Core Functionality

- **Automated Scanning**: Periodically scans Airtable for videos ready for ingestion
- **State Management**: Valid state transitions with rollback capabilities
- **Error Handling**: Comprehensive error recovery and retry logic
- **Idempotency**: Safe to retry failed operations
- **Webhook Verification**: HMAC signature validation for security
- **Status Tracking**: Real-time updates to Airtable records

### State Machine

```
draft → ready_for_ingest → ingesting → processing → ready_to_stream → (handoff)
                          ↓
                       error → ready_for_ingest
```

### Supported Webhooks

- `video.ready` - Stream import completed successfully
- `video.failed` - Stream import failed
- `video.processing` - Stream import in progress

---

## Project Structure

```
workers/ingestion/
├── pyproject.toml           # Python project config & dependencies
├── wrangler.toml            # Cloudflare Worker configuration
├── uv.lock                  # Dependency lockfile
├── src/
│   ├── __init__.py
│   ├── entry.py             # Worker entrypoint (fetch + scheduled)
│   ├── config.py            # Environment configuration
│   ├── eligibility.py       # Ingestion eligibility rules
│   ├── handoff.py           # Downstream handoff logic
│   ├── publication_flow.py  # R2 → Stream import orchestration
│   ├── trigger_job.py       # Scheduled trigger job
│   ├── reconciliation_job.py # Scheduled reconciliation job
│   ├── webhook_handler.py   # Stream webhook processor
│   ├── airtable_client.py   # Airtable API client
│   ├── stream_client.py     # Stream API client
│   └── domain/
│       ├── __init__.py
│       ├── video_record.py  # Video record normalization
│       └── video_state.py   # State transition validation
│   └── lib/
│       ├── __init__.py
│       ├── idempotency.py   # Idempotency keys
│       └── operator_errors.py # Error message formatting
└── tests/
    ├── test_entrypoint.py
    ├── test_config.py
    ├── test_video_record.py
    ├── test_video_state.py
    ├── test_eligibility.py
    ├── test_airtable_client.py
    ├── test_stream_client.py
    ├── test_publication_flow.py
    ├── test_trigger_job.py
    ├── test_reconciliation_job.py
    └── test_webhook_handler.py
```

---

## Prerequisites

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.13+ | Runtime |
| [uv](https://github.com/astral-sh/uv) | Latest | Package management |
| [pywrangler](https://github.com/cloudflare/workers-py) | Latest | Cloudflare Workers CLI |
| Git | Latest | Version control |

### Python Dependencies

All dependencies are managed via `uv` and defined in `pyproject.toml`:

```toml
[dependency-groups]
dev = [
  "workers-py",
  "workers-runtime-sdk", 
  "pytest>=8.3.0",
  "pytest-asyncio>=0.23.0",
]
```

---

## Quick Start

### 1. Clone the Repository

```bash
# Navigate to the worktree
git worktree add airtable-control-plane docs/airtable-control-plane
cd .worktrees/airtable-control-plane

# Or clone directly
cd workers/ingestion
```

### 2. Set Up Python Environment

```bash
# Install uv if not already installed
curl -LsSf https://astral.sh/uv/install.sh | sh

# Sync dependencies
uv sync

# Create virtual environment (optional)
uv venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### 3. Configure Environment

Create a `.env` file in the `workers/ingestion` directory:

```bash
# Airtable Configuration
AIRTABLE_API_TOKEN=your_airtable_api_token
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=Videos

# Cloudflare Configuration  
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_STREAM_API_TOKEN=your_stream_api_token

# Webhook Configuration (optional)
WEBHOOK_SECRET=your_hmac_secret_for_webhook_verification
HANDOFF_ENDPOINT=https://your-downstream-service/webhook
```

---

## Configuration

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `AIRTABLE_API_TOKEN` | ✅ Yes | Airtable API token | `patXXXXXXXXXXXXXX` |
| `AIRTABLE_BASE_ID` | ✅ Yes | Airtable base ID | `appXXXXXXXXXXXXXX` |
| `AIRTABLE_TABLE_NAME` | ✅ Yes | Airtable table name | `Videos` |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ Yes | Cloudflare account ID | `XXXXXXXXXXXXXXXXXXXX` |
| `CLOUDFLARE_STREAM_API_TOKEN` | ✅ Yes | Stream API token | `XXXXXXXXXXXXXXXX` |
| `WEBHOOK_SECRET` | ❌ No | HMAC secret for webhook verification | `your-secret-key` |
| `HANDOFF_ENDPOINT` | ❌ No | Downstream webhook URL | `https://api.example.com/webhook` |

### Worker Configuration (wrangler.toml)

```toml
name = "master-library-ingestion"
main = "src/entry.py"
compatibility_date = "2026-06-07"
compatibility_flags = ["python_workers"]

[triggers]
crons = ["*/5 * * * *", "*/15 * * * *"]

# Environment variables (set via wrangler or Cloudflare dashboard)
# [vars]
# AIRTABLE_API_TOKEN = "@AIRTABLE_API_TOKEN"
# AIRTABLE_BASE_ID = "@AIRTABLE_BASE_ID"
# AIRTABLE_TABLE_NAME = "@AIRTABLE_TABLE_NAME"
# CLOUDFLARE_ACCOUNT_ID = "@CLOUDFLARE_ACCOUNT_ID"
# CLOUDFLARE_STREAM_API_TOKEN = "@CLOUDFLARE_STREAM_API_TOKEN"
```

---

## Deployment

### Local Development

#### Start the Development Server

```bash
# From workers/ingestion directory
cd workers/ingestion

# Install dependencies
uv sync

# Start local dev server
uv run pywrangler dev
```

The worker will be available at `http://localhost:8787`

#### Test the Webhook Endpoint

```bash
# Send a test webhook
curl -X POST http://localhost:8787/webhooks/stream \
  -H "Content-Type: application/json" \
  -H "CF-Signature: $(echo -n '{"type":"video.ready"}' | openssl dgst -sha256 -hmac "your-secret" | cut -d' ' -f2)" \
  -d '{"type":"video.ready","uid":"test-uid","readyToStream":true}'
```

### Cloudflare Deployment

#### 1. Authenticate with Cloudflare

```bash
# Login to Cloudflare
uv run pywrangler login

# Or use API token
uv run pywrangler config set --token YOUR_CLOUDFLARE_API_TOKEN
```

#### 2. Deploy to Cloudflare

```bash
# From workers/ingestion directory
cd workers/ingestion

# Deploy to production
uv run pywrangler deploy

# Deploy with environment variables
AIRTABLE_API_TOKEN=your_token \
AIRTABLE_BASE_ID=your_base \
AIRTABLE_TABLE_NAME=Videos \
CLOUDFLARE_ACCOUNT_ID=your_account \
CLOUDFLARE_STREAM_API_TOKEN=your_stream_token \
uv run pywrangler deploy
```

#### 3. Configure Environment Variables in Cloudflare Dashboard

After deployment, set the environment variables in the Cloudflare Workers dashboard:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to Workers & Pages
3. Select your worker
4. Go to Settings → Variables
5. Add all required environment variables

#### 4. Set Up Cron Triggers

The worker is configured with two cron triggers:
- `*/5 * * * *` - Trigger job (every 5 minutes)
- `*/15 * * * *` - Reconciliation job (every 15 minutes)

These are defined in `wrangler.toml` and will be automatically configured on deployment.

---

## Testing

### Run All Tests

```bash
# From workers/ingestion directory
cd workers/ingestion

# Run full test suite
uv run pytest tests/ -v

# Run with coverage
uv run pytest tests/ --cov=src --cov-report=html

# Run specific test file
uv run pytest tests/test_webhook_handler.py -v

# Run specific test
uv run pytest tests/test_webhook_handler.py::test_verify_webhook_auth_passes_with_signature -v
```

### Test Coverage

The project maintains **91+ passing tests** covering:

- ✅ Configuration management
- ✅ Video record normalization
- ✅ State transitions
- ✅ Eligibility validation
- ✅ Airtable API operations
- ✅ Stream API operations
- ✅ Publication flow
- ✅ Trigger job orchestration
- ✅ Reconciliation job recovery
- ✅ Webhook handling
- ✅ HMAC verification
- ✅ Worker entrypoint routing

### Test Environment Setup

For testing, the modules use dependency injection to allow mocking:

```python
# Example: Testing with mock HTTP client
from src.trigger_job import run_trigger_job

class MockHTTPClient:
    async def request(self, url, options):
        # Return mock response
        class MockResponse:
            ok = True
            async def json(self):
                return {"records": []}
            async def text(self):
                return "{}"
        return MockResponse()

# Inject mock client
result = await run_trigger_job()
```

---

## 🔄 How It Works

### 1. Trigger Job (Every 5 Minutes)

```
┌────────────────────────────────────────────────────────────────────┐
│                    Trigger Job Flow                                │
├────────────────────────────────────────────────────────────────────┤
│  1. Scan Airtable for videos with Sync Status = 'ready_for_ingest' │
│  2. For each eligible video:                                       │
│     a. Normalize video record                                      │
│     b. Validate eligibility                                        │
│     c. Claim video (transition to 'ingesting')                     │
│     d. Build R2 URL from primary asset                             │
│     e. Create Stream import request                                │
│     f. Update Airtable with 'processing' status                    │
│     g. Store cloudflare_uid in Airtable                            │
└────────────────────────────────────────────────────────────────────┘
```

### 2. Webhook Processing

```
┌─────────────────────────────────────────────────────────────┐
│                    Webhook Flow                             │
├─────────────────────────────────────────────────────────────┤
│  1. Receive webhook from Cloudflare Stream                  │
│  2. Verify HMAC signature (if WEBHOOK_SECRET configured)    │
│  3. Parse webhook payload                                   │
│  4. Determine next state:                                   │
│     - readyToStream → 'ready_to_stream'                     │
│     - failed → 'error'                                      │
│     - processing → 'processing'                             │
│  5. Update Airtable record with new status                  │
│  6. If ready_to_stream:                                     │
│     a. Build handoff payload                                │
│     b. Send to downstream endpoint (if configured)          │
└─────────────────────────────────────────────────────────────┘
```

### 3. Reconciliation Job (Every 15 Minutes)

```
┌─────────────────────────────────────────────────────────────┐
│                 Reconciliation Job Flow                     │
├─────────────────────────────────────────────────────────────┤
│  1. Scan Airtable for videos in 'processing' or 'ingesting' │
│     state older than expected timeout                       │
│  2. For each stuck video:                                   │
│     a. Check Stream import status                           │
│     b. If Stream reports 'readyToStream':                   │
│        - Update Airtable to 'ready_to_stream'               │
│     c. If Stream reports 'failed':                          │
│        - Update Airtable to 'error'                         │
│     d. If Stream still 'processing':                        │
│        - Leave as-is (still processing)                     │
│     e. If Stream unreachable:                               │
│        - Log error, keep current state                      │
└─────────────────────────────────────────────────────────────┘
```

---

## API Reference

### Webhook Endpoint

**POST** `/webhooks/stream`

Processes Cloudflare Stream webhook events.

**Headers:**
- `Content-Type: application/json`
- `CF-Signature: <HMAC-SHA256 signature>` (if WEBHOOK_SECRET configured)

**Request Body:**
```json
{
  "type": "video.ready|video.failed|video.processing",
  "uid": "stream-video-uid",
  "readyToStream": true,
  "failed": false,
  "playback": {
    "hls": "https://...",
    "dash": "https://..."
  }
}
```

**Response:**
```json
{
  "next_status": "ready_to_stream|error|processing",
  "record_id": "recXXXXXXXXXXXXXX",
  "updated": true
}
```

### Health Check

**GET** `/`

Returns basic health status.

**Response:**
```
Worker is running
```

---

## Contributing

We welcome contributions! Please follow these guidelines:

### Getting Started

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Set up development environment**
   ```bash
   cd workers/ingestion
   uv sync
   ```

### Development Workflow

1. **Make your changes** in the appropriate module
2. **Add tests** for new functionality
3. **Run tests** to ensure nothing breaks
   ```bash
   uv run pytest tests/ -v
   ```
4. **Run linting** (if configured)
5. **Commit your changes** with descriptive messages
   ```bash
   git commit -m "feat: add new feature description"
   ```
6. **Push to your fork**
7. **Submit a Pull Request**

### Code Style Guidelines

- **Python**: Follow PEP 8 style guide
- **Type Hints**: Use Python type hints for better code clarity
- **Docstrings**: Include docstrings for all public functions and classes
- **Tests**: Write comprehensive tests for all new functionality
- **Commits**: Use conventional commit messages (feat:, fix:, docs:, etc.)

### Testing Requirements

- All new code must have corresponding tests
- Tests should cover both happy paths and error cases
- Maintain >90% test coverage
- Use dependency injection for testability

### Pull Request Process

1. Ensure all tests pass
2. Update documentation if needed
3. Include a clear description of changes
4. Reference any related issues
5. Wait for code review and approval

### Reporting Issues

When reporting issues, please include:

- Python version
- Cloudflare Workers runtime version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or error messages

---

## Troubleshooting

### Common Issues

#### 1. Import Errors

**Problem**: `ModuleNotFoundError: No module named 'workers'`

**Solution**: 
```bash
# Ensure you're in the workers/ingestion directory
cd workers/ingestion

# Sync dependencies
uv sync

# Use the virtual environment
source .venv/bin/activate
```

#### 2. Authentication Errors

**Problem**: `Missing required env: AIRTABLE_API_TOKEN`

**Solution**: Ensure all required environment variables are set:
```bash
# Set environment variables
export AIRTABLE_API_TOKEN=your_token
export AIRTABLE_BASE_ID=your_base
export CLOUDFLARE_ACCOUNT_ID=your_account
```

#### 3. Webhook Signature Verification Failed

**Problem**: `Invalid HMAC signature`

**Solution**: 
- Ensure `WEBHOOK_SECRET` is set in environment
- Verify the signature is computed correctly
- Check that the request body is not modified

#### 4. Airtable API Errors

**Problem**: `Airtable read failed (401): Unauthorized`

**Solution**:
- Verify your `AIRTABLE_API_TOKEN` is valid
- Check that the token has the correct permissions
- Ensure the base ID and table name are correct

#### 5. Stream Import Failures

**Problem**: `Stream import request failed (400): Invalid URL`

**Solution**:
- Verify the R2 URL format: `https://{account_id}.r2.cloudflarestorage.com/v1/public/{key}`
- Ensure the R2 bucket and object exist
- Check that the Stream API token is valid

### Debug Mode

Enable debug logging by setting the `DEBUG` environment variable:

```bash
export DEBUG=true
uv run pywrangler dev
```

### Logs

View Cloudflare Worker logs:

```bash
# Tail logs in real-time
uv run pywrangler tail

# View recent logs
uv run pywrangler logs
```

---

## Architecture Documentation

Detailed architecture and design documents:

- **Airtable Control Plane Design**: [`docs/superpowers/specs/2026-06-07-airtable-control-plane-design.md`](docs/superpowers/specs/2026-06-07-airtable-control-plane-design.md)
- **Airtable Control Plane Plan**: [`docs/superpowers/plans/2026-06-07-airtable-control-plane.md`](docs/superpowers/plans/2026-06-07-airtable-control-plane.md)
- **Ingestion Pipeline Design**: [`docs/superpowers/specs/2026-06-07-ingestion-publication-pipeline-design.md`](docs/superpowers/specs/2026-06-07-ingestion-publication-pipeline-design.md)
- **Ingestion Pipeline Plan**: [`docs/superpowers/plans/2026-06-07-ingestion-publication-pipeline.md`](docs/superpowers/plans/2026-06-07-ingestion-publication-pipeline.md)

---

## License

This project is part of an ongoing initative to make the recordings of teachings from Dzogchen Ponlop Rinpoche and other teachers at Nalandabodhi. The source code is shared with the intention of supporting similar initatives such that they readily deploy their own digital library. This work is licensed under the terms specified in the main repository LICENSE file.

---

## Support

For questions, issues, or contributions:

- **Repository**: [nalandabodhi/master-library](https://github.com/nalandabodhi/master-library)
- **Issues**: [GitHub Issues](https://github.com/nalandabodhi/master-library/issues)
- **Documentation**: [Docs](docs/)

---

*Last updated: 2026-06-14*
*Version: 0.1.0*
