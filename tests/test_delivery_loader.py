from pathlib import Path

import pytest

from master_library.delivery_config import (
    DeliveryConfig,
    load_delivery_config,
    load_environment_config,
)


def test_delivery_config_reads_json_file() -> None:
    config_path = Path(__file__).with_name("dev.json")
    config = DeliveryConfig.model_validate_json(config_path.read_text())

    assert config.environment == "dev"
    assert config.account_id == "cf-account-dev-123"
    assert config.worker_name == "master-library-catalog-dev"


def test_load_delivery_config_reads_json_file() -> None:
    config = load_delivery_config(Path(__file__).with_name("dev.json"))

    assert config.environment == "dev"
    assert config.account_id == "cf-account-dev-123"


def test_delivery_config_renders_canonical_json() -> None:
    config = load_delivery_config(Path(__file__).with_name("dev.json"))
    rendered = config.render()

    assert rendered["environment"] == "dev"
    assert rendered["account_id"] == "cf-account-dev-123"
    assert config.render_json().startswith('{"account_id"')


def test_load_environment_config_reads_dev_fixture() -> None:
    config = load_environment_config("dev")

    assert config.environment == "dev"
    assert config.worker_name == "master-library-catalog-dev"


def test_load_environment_config_rejects_placeholder_prod_fixture() -> None:
    with pytest.raises(ValueError, match="REPLACE_WITH"):
        load_environment_config("prod")


def test_delivery_config_rejects_cross_environment_placeholder_mismatch() -> None:
    with pytest.raises(ValueError, match="REPLACE_WITH"):
        DeliveryConfig.model_validate(
            {
                "environment": "prod",
                "account_id": "REPLACE_WITH_PROD_ACCOUNT_ID",
                "worker_name": "master-library-catalog-prod",
                "d1_database_name": "master-library-catalog-prod",
                "r2_bucket_name": "master-library-catalog-prod",
                "queue_name": "catalog-reconcile-prod",
            }
        )
