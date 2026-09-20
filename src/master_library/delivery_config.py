from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


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
