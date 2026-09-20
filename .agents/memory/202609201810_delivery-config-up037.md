# Fixing UP037 on delivery config

Date: 2026-09-20

Implemented the Ruff UP037 fix on `src/master_library/delivery_config.py` by removing the quoted `DeliveryConfig` return annotations while keeping the existing `from __future__ import annotations` import. This was a no-behavior change and matched the rule's exact recommendation.

Validation:
- `uv run ruff check` -> passed
- `uv run pytest tests/test_delivery_config.py tests/test_delivery_loader.py -q` -> 9 passed
- `uv run pre-commit run --all-files` -> passed

No commit or push was made; only the reviewed lint fix was staged for developer review.
