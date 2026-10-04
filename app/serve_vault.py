"""Run the oxivault API against R2 for the single app container.

The CLI ``serve`` command only supports local stores, so the container
builds the FastAPI app directly with an S3-backed store on the private
bucket (vault notes under the ``vault/`` prefix) and static editor-token
auth. The server binds loopback only; the SvelteKit BFF is the sole
public-facing process (ADR-0004).
"""

from __future__ import annotations

import logging
import os

import uvicorn
from oxivault.server import ApiServerConfig, create_app
from oxivault.store.s3 import S3Store
from oxivault.vault import Vault

logger = logging.getLogger(__name__)


def _env(name: str) -> str:
    try:
        return os.environ[name]
    except KeyError as err:
        raise SystemExit(f"missing required environment variable: {name}") from err


def main() -> None:
    """Start the loopback oxivault API process."""
    logging.basicConfig(level=logging.INFO)

    store = S3Store(
        bucket=_env("R2_BUCKET_PRIVATE"),
        prefix=os.environ.get("VAULT_PREFIX", "vault"),
        endpoint_url=_env("S3_ENDPOINT_URL"),
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=_env("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=_env("S3_SECRET_ACCESS_KEY"),
    )
    config = ApiServerConfig(
        auth_enabled=True,
        editor_tokens={_env("OXIVAULT_EDITOR_TOKEN")},
        cors_allowed_origins=[],
    )
    app = create_app(Vault(store=store), config)

    host = os.environ.get("VAULT_API_HOST", "127.0.0.1")
    port = int(os.environ.get("VAULT_API_PORT", "8000"))
    logger.info("oxivault API listening on http://%s:%d (loopback)", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
