#!/usr/bin/env bash
# Wrap Newman with environment selection, folder filtering, and reporter
# choices. Resolves Newman from the repo's pinned `node_modules` (via
# `pnpm exec newman`) so CI uses the same version as local dev.
#
# Usage:
#   run-newman.sh --env <local|ci|production> [options]
#
# Options:
#   --env <name>            Environment file to load (REQUIRED).
#   --folder <name>         Limit run to the named folder (recursively).
#                           Default: "PR Suite". Use "" to run everything.
#   --delay-request <ms>    Delay between requests (Newman flag). Required for
#                           the deep-analysis polling pattern. Default: 0.
#   --reporter <mode>       cli-only | junit-only | both (default: both).
#   --bail                  Stop on first failure (Newman flag).
#   --working-dir <path>    Override Newman working directory (default:
#                           backend/tests/postman/).
#
# Exit code: Newman's exit code (0 = pass, non-zero = at least one failure).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECTION="$HERE/aurialis-backend.postman_collection.json"
RESULTS_DIR="$HERE/results"
mkdir -p "$RESULTS_DIR"

ENV_NAME=""
FOLDER="PR Suite"
DELAY_REQUEST=0
REPORTER="both"
BAIL=""
WORKING_DIR="$HERE"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)            ENV_NAME="$2"; shift 2 ;;
    --folder)         FOLDER="$2"; shift 2 ;;
    --delay-request)  DELAY_REQUEST="$2"; shift 2 ;;
    --reporter)       REPORTER="$2"; shift 2 ;;
    --bail)           BAIL="--bail"; shift ;;
    --working-dir)    WORKING_DIR="$2"; shift 2 ;;
    -h|--help)        sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$ENV_NAME" ]]; then
  echo "ERROR: --env is required (one of: local, ci, production)" >&2
  exit 2
fi

ENV_FILE="$HERE/environments/${ENV_NAME}.postman_environment.json"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: environment file not found: $ENV_FILE" >&2
  exit 2
fi

case "$REPORTER" in
  cli-only)   REPORTER_FLAGS="--reporters cli" ;;
  junit-only) REPORTER_FLAGS="--reporters junit --reporter-junit-export $RESULTS_DIR/newman-results.xml" ;;
  both)       REPORTER_FLAGS="--reporters cli,junit --reporter-junit-export $RESULTS_DIR/newman-results.xml" ;;
  *) echo "Unknown reporter: $REPORTER" >&2; exit 2 ;;
esac

# Resolve Newman runner. Prefer pinned local install (Task 7); fall back to
# global newman if present (handy for ad-hoc dev before `pnpm install`).
if [[ -x "$HERE/../../../node_modules/.bin/newman" ]]; then
  NEWMAN=("$HERE/../../../node_modules/.bin/newman")
elif command -v pnpm >/dev/null 2>&1 && pnpm exec --silent newman --version >/dev/null 2>&1; then
  NEWMAN=(pnpm exec newman)
elif command -v newman >/dev/null 2>&1; then
  NEWMAN=(newman)
else
  echo "ERROR: newman not found. Run \`pnpm install\` from the repo root first." >&2
  exit 2
fi

CMD=("${NEWMAN[@]}" run "$COLLECTION"
     -e "$ENV_FILE"
     --working-dir "$WORKING_DIR")

# Newman 6 rejects --delay-request 0; only pass when positive.
if [[ "$DELAY_REQUEST" -gt 0 ]]; then
  CMD+=(--delay-request "$DELAY_REQUEST")
fi

if [[ -n "$FOLDER" ]]; then
  CMD+=(--folder "$FOLDER")
fi

if [[ -n "$BAIL" ]]; then
  CMD+=("$BAIL")
fi

# shellcheck disable=SC2086
CMD+=($REPORTER_FLAGS)

echo "+ ${CMD[*]}"
exec "${CMD[@]}"
