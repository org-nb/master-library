#!/usr/bin/env bash
# Single-container entrypoint (ADR-0004): start the oxivault API
# (loopback) and the SvelteKit server (public port); exit if either dies.
set -uo pipefail

python serve_vault.py &
OXIVAULT_PID=$!
node build/index.js &
APP_PID=$!

shutdown() {
	kill "$OXIVAULT_PID" "$APP_PID" 2>/dev/null || true
}
trap shutdown INT TERM

# wait -n returns as soon as either child exits; its status is the
# child's. No `set -e` here: we must run shutdown even on failure.
wait -n
STATUS=$?
shutdown
exit "$STATUS"
