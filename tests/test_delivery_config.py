import pytest

from master_library.delivery_config import DeliveryConfig


def test_delivery_config_rejects_placeholder_account_ids() -> None:
    with pytest.raises(ValueError, match="REPLACE_WITH"):
        DeliveryConfig.model_validate(
            {
                "environment": "dev",
                "account_id": "REPLACE_WITH_DEV_ACCOUNT_ID",
                "worker_name": "master-library-catalog-dev",
                "d1_database_name": "master-library-catalog-dev",
                "r2_bucket_name": "master-library-catalog-dev",
                "queue_name": "catalog-reconcile-dev",
            }
        )


def test_delivery_config_accepts_real_environment_values() -> None:
    config = DeliveryConfig.model_validate(
        {
            "environment": "prod",
            "account_id": "cf-account-prod-123",
            "worker_name": "master-library-catalog-prod",
            "d1_database_name": "master-library-catalog-prod",
            "r2_bucket_name": "master-library-catalog-prod",
            "queue_name": "catalog-reconcile-prod",
        }
    )

    assert config.environment == "prod"
    assert config.account_id == "cf-account-prod-123"
