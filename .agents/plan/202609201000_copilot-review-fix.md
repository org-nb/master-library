# Plan: fix Copilot review findings

## Problem

The branch is close to mergeable, but the current review feedback points to a few concrete follow-ups: GitHub Actions hygiene/security checks, compatibility drift in the Python toolchain, and a small set of repo-maintenance issues that should be resolved before the branch is merged.

## Proposed approach

1. Resolve the actionable CI and security findings first, starting with pinning GitHub Actions to immutable SHAs and setting the recommended `persist-credentials: false` on checkout steps.
2. Reconcile the Python/ruff/pre-commit toolchain so the local gate and GitHub Actions agree on versions and behavior.
3. Remove non-source artifacts from the branch (`.github/skills`, cache directories, generated artifacts) and add the necessary ignores to keep the working tree clean.
4. Validate the branch with the narrow repo gate (`ruff`, `pre-commit`, and any relevant tests/workflows checks) before marking it ready for review.

## Todo list

- Confirm the current GitHub Actions workflow files are compliant with the security baseline.
- Update the pinned action versions and checkout configuration in `.github/workflows/`.
- Align `ruff`/`pre-commit` versions in `.pre-commit-config.yaml` and `pyproject.toml` so local and CI checks agree.
- Fix any remaining lint/format/type issues surfaced by the local gate.
- Remove `.github/skills` and cache files from the branch and add ignore entries for them.
- Re-run the relevant validation commands and check `git status` to verify the branch is clean and review-ready.

## Notes and considerations

- The Workflows review is the highest-priority item because it is explicitly blocking on pinned-actions and credential persistence checks.
- The repo already has a strict toolchain baseline (`ruff`, `pre-commit`, `ty`); don't widen the scope beyond those files unless a failure requires it.
- Do not change release or deployment semantics while fixing security hygiene unless the workflow logic truly requires it.
- Keep the fix set small and reviewable: one branch, one toolchain alignment, one cleanliness pass, one validation pass.
