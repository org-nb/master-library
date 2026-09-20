from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class DeliveryConfig(BaseModel):
    """Validated environment metadata for the isolated Cloudflare delivery boundary."""

    environment: Literal["dev", "prod"] = Field(
        ..., description="Deployment environment label."
    )
    account_id: str = Field(
        ...,
        min_length=3,
        description="Cloudflare account ID for the target environment.",
    )
    worker_name: str = Field(..., min_length=3, description="Wrangler worker name.")
    d1_database_name: str = Field(..., min_length=3, description="D1 database name.")
    r2_bucket_name: str = Field(
        ..., min_length=3, description="Private transcript bucket name."
    )
    queue_name: str = Field(..., min_length=3, description="Reconciliation queue name.")

    @field_validator(
        "account_id", "worker_name", "d1_database_name", "r2_bucket_name", "queue_name"
    )
    @classmethod
    def reject_placeholder_values(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("required value cannot be empty")
        if "REPLACE_WITH" in cleaned.upper():
            raise ValueError(
                "placeholder values must be replaced before delivery changes are applied"
            )
        if "TODO" in cleaned.upper():
            raise ValueError("TODO placeholders are not valid delivery configuration")
        return cleaned

    @field_validator("environment")
    @classmethod
    def environment_must_be_known(cls, value: str) -> str:
        if value not in {"dev", "prod"}:
            raise ValueError("environment must be either 'dev' or 'prod'")
        return value

    @model_validator(mode="after")
    def environment_must_match_resource_names(self) -> "DeliveryConfig":
        env = self.environment
        resource_tokens = {
            "worker_name": self.worker_name,
            "d1_database_name": self.d1_database_name,
            "r2_bucket_name": self.r2_bucket_name,
            "queue_name": self.queue_name,
        }
        for field_name, resource_name in resource_tokens.items():
            if env == "dev" and "prod" in resource_name.lower():
                raise ValueError(
                    f"{field_name} must not include prod naming when environment is 'dev'"
                )
            if env == "prod" and "dev" in resource_name.lower():
                raise ValueError(
                    f"{field_name} must not include dev naming when environment is 'prod'"
                )
        if env == "dev" and "prod" in self.account_id.lower():
            raise ValueError(
                "account_id must not reference the production account in a dev config"
            )
        if env == "prod" and "dev" in self.account_id.lower():
            raise ValueError(
                "account_id must not reference the development account in a prod config"
            )
        return self

    @classmethod
    def from_json(cls, payload: str) -> "DeliveryConfig":
        """Parse a JSON string into a validated delivery config."""
        return cls.model_validate_json(payload)

    @classmethod
    def from_file(cls, path: str | Path) -> "DeliveryConfig":
        """Load a delivery config from a JSON file path."""
        config_path = Path(path)
        return cls.model_validate(json.loads(config_path.read_text(encoding="utf-8")))

    def render(self) -> dict[str, str]:
        """Return the canonical JSON-serializable representation for environment rendering."""
        return {
            "environment": self.environment,
            "account_id": self.account_id,
            "worker_name": self.worker_name,
            "d1_database_name": self.d1_database_name,
            "r2_bucket_name": self.r2_bucket_name,
            "queue_name": self.queue_name,
        }

    def render_json(self) -> str:
        """Render the config as a compact JSON payload for downstream tooling."""
        return json.dumps(self.render(), separators=(",", ":"), sort_keys=True)


def load_delivery_config(path: str | Path) -> DeliveryConfig:
    """Load and validate a delivery configuration from a JSON file path."""
    return DeliveryConfig.from_file(path)


def load_environment_config(
    environment: Literal["dev", "prod"],
    root: str | Path | None = None,
) -> DeliveryConfig:
    """Resolve and validate a delivery config for a known environment name."""
    config_root = (
        Path(root)
        if root is not None
        else Path(__file__).resolve().parents[2] / "config" / "environments"
    )
    config_path = config_root / f"{environment}.json"
    return load_delivery_config(config_path)
