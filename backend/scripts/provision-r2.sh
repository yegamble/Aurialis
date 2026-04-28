#!/usr/bin/env bash
# Provision the aurialis-uploads R2 bucket idempotently.
# Run from the backend/ directory.
#
# Prerequisites: `wrangler login` against the Cloudflare account that hosts
# aurialis-core. Workers Paid + R2 enabled.
#
# Manual steps NOT covered by this script (do them in the dashboard):
#   1. Create R2 API token (R2 → Manage R2 API Tokens) scoped to
#      "Object Read & Write" on aurialis-uploads only. Save the access key id +
#      secret access key + jurisdictional endpoint.
#   2. `wrangler secret put R2_ACCESS_KEY_ID --name aurialis-core`
#      `wrangler secret put R2_SECRET_ACCESS_KEY --name aurialis-core`
#      `wrangler secret put R2_ACCOUNT_ID --name aurialis-core`
#      `wrangler secret put TURNSTILE_SECRET_KEY --name aurialis-core`
#   3. Create Turnstile widget (Turnstile dashboard) — invisible mode.
#      Copy the site key into wrangler.jsonc `vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
#   4. Set up Cloudflare billing alert at $50/day on the R2 line item
#      (Billing → Alerts → New Alert → R2 Storage / Class A operations).

set -euo pipefail

BUCKET="aurialis-uploads"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cors_file="$BACKEND_DIR/r2-cors.json"
lifecycle_file="$BACKEND_DIR/r2-lifecycle.json"

if [[ ! -f "$cors_file" ]]; then
    echo "ERROR: $cors_file not found" >&2
    exit 1
fi
if [[ ! -f "$lifecycle_file" ]]; then
    echo "ERROR: $lifecycle_file not found" >&2
    exit 1
fi

echo "==> Ensuring bucket $BUCKET exists"
if wrangler r2 bucket list 2>/dev/null | grep -q "^$BUCKET$"; then
    echo "    bucket already exists, skipping create"
else
    wrangler r2 bucket create "$BUCKET"
fi

echo "==> Applying lifecycle rules (48h object expiration + 1d incomplete-multipart abort)"
wrangler r2 bucket lifecycle put "$BUCKET" --file="$lifecycle_file"

echo "==> Applying CORS rules (PUT from aurialis.yosefgamble.com + localhost:3000)"
wrangler r2 bucket cors put "$BUCKET" --file="$cors_file"

echo ""
echo "Done. Verify with:"
echo "    wrangler r2 bucket lifecycle get $BUCKET"
echo "    wrangler r2 bucket cors get $BUCKET"
echo ""
echo "Next: do the manual dashboard steps listed at the top of this script."
