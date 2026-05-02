#!/usr/bin/env bash
# ============================================================================
# Social Monitor — Client provisioning script
#
# Spins up a new isolated client instance on this VPS in ~30 seconds:
#   1. Clones the boilerplate repo into /opt/clients/<slug>
#   2. Generates .env from .env.example with your inputs
#   3. Replaces logo
#   4. npm install
#   5. Initializes SQLite DB
#   6. Starts PM2 process on a unique port
#   7. Adds entry to /etc/cloudflared/config.yml
#   8. Creates Cloudflare DNS CNAME via API
#   9. Restarts cloudflared
#  10. Health-check the deployed URL
#
# Usage (interactive):
#   sudo bash provision-client.sh
#
# Usage (flags, all required):
#   sudo bash provision-client.sh \
#     --slug acme \
#     --name "Acme Corp" \
#     --location "Panama" \
#     --description "una empresa de servicios automotrices" \
#     --port 3003 \
#     --subdomain acme.hrikrdo.com \
#     --ig-id 178414xxxxx \
#     --fb-id 11365xxxxx \
#     --ad-account 15810xxxxx \
#     --filter acme \
#     --logo /tmp/acme-logo.jpg \
#     --brand-color "#0066ff" \
#     --brand-color-deep "#001e4d"
#
# Pre-requisites on the VPS:
#   - Node 18+, npm, pm2, git, jq, curl
#   - cloudflared running with config at /etc/cloudflared/config.yml
#   - A .env file at $CONFIG_DIR with shared secrets:
#       META_ACCESS_TOKEN, ANTHROPIC_API_KEY, CLOUDFLARE_API_TOKEN,
#       CLOUDFLARE_ZONE_ID, TUNNEL_ID, REPO_URL
# ============================================================================

set -euo pipefail

# ---------- Defaults & globals ----------
REPO_URL="${REPO_URL:-https://github.com/hrikrdo/social-monitor-boilerplate.git}"
CLIENTS_DIR="${CLIENTS_DIR:-/opt/clients}"
CONFIG_DIR="${CONFIG_DIR:-/opt/clients/.shared}"
CLOUDFLARED_CONFIG="${CLOUDFLARED_CONFIG:-/etc/cloudflared/config.yml}"
SHARED_ENV="$CONFIG_DIR/shared.env"

# Colors
GRN='\033[0;32m'; RED='\033[0;31m'; YLW='\033[0;33m'; NC='\033[0m'
log()  { echo -e "${GRN}[provision]${NC} $*"; }
warn() { echo -e "${YLW}[warn]${NC} $*"; }
fail() { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ---------- Parse flags ----------
SLUG=""; NAME=""; LOCATION=""; DESCRIPTION=""; PORT=""; SUBDOMAIN=""
IG_ID=""; FB_ID=""; AD_ACCOUNT=""; FILTER=""; LOGO=""
BRAND_COLOR="#00d750"; BRAND_COLOR_DEEP="#0a3d18"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --subdomain) SUBDOMAIN="$2"; shift 2 ;;
    --ig-id) IG_ID="$2"; shift 2 ;;
    --fb-id) FB_ID="$2"; shift 2 ;;
    --ad-account) AD_ACCOUNT="$2"; shift 2 ;;
    --filter) FILTER="$2"; shift 2 ;;
    --logo) LOGO="$2"; shift 2 ;;
    --brand-color) BRAND_COLOR="$2"; shift 2 ;;
    --brand-color-deep) BRAND_COLOR_DEEP="$2"; shift 2 ;;
    -h|--help) sed -n '/^# Usage/,/^# ---/p' "$0"; exit 0 ;;
    *) fail "Unknown flag: $1" ;;
  esac
done

# ---------- Interactive fallback ----------
ask() {
  local prompt="$1"; local var="$2"; local default="${3:-}"
  if [[ -z "${!var}" ]]; then
    if [[ -n "$default" ]]; then
      read -r -p "$prompt [$default]: " val; val="${val:-$default}"
    else
      read -r -p "$prompt: " val
    fi
    eval "$var=\$val"
  fi
}

if [[ -t 0 ]]; then
  ask "Client slug (lowercase, hyphens)" SLUG
  ask "Client display name" NAME
  ask "Client country/location" LOCATION "Panama"
  ask "1-line description (for AI prompt)" DESCRIPTION "una marca con presencia digital"
  ask "Port (unique per client)" PORT "3003"
  ask "Full subdomain (e.g. acme.hrikrdo.com)" SUBDOMAIN
  ask "Instagram Business Account ID" IG_ID
  ask "Facebook Page ID" FB_ID
  ask "Ad Account ID (no act_ prefix)" AD_ACCOUNT
  ask "Campaign filter keyword (empty = all)" FILTER
  ask "Logo path (jpg/png, square)" LOGO
  ask "Brand color hex (#RRGGBB)" BRAND_COLOR "#00d750"
  ask "Brand deep color hex" BRAND_COLOR_DEEP "#0a3d18"
fi

# ---------- Validate ----------
[[ -z "$SLUG" ]] && fail "--slug is required"
[[ -z "$NAME" ]] && fail "--name is required"
[[ -z "$PORT" ]] && fail "--port is required"
[[ -z "$SUBDOMAIN" ]] && fail "--subdomain is required"
[[ -z "$IG_ID" ]] && fail "--ig-id is required"
[[ -z "$FB_ID" ]] && fail "--fb-id is required"
[[ -z "$AD_ACCOUNT" ]] && fail "--ad-account is required"
[[ -n "$LOGO" && ! -f "$LOGO" ]] && fail "Logo file not found: $LOGO"

# Slug must be safe
[[ ! "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]] && fail "Slug must be lowercase, alphanumeric, hyphens only"

CLIENT_DIR="$CLIENTS_DIR/$SLUG"
[[ -d "$CLIENT_DIR" ]] && fail "Directory already exists: $CLIENT_DIR (delete it first if you want to redeploy)"

# Load shared secrets
if [[ -f "$SHARED_ENV" ]]; then
  log "Loading shared secrets from $SHARED_ENV"
  # shellcheck disable=SC1090
  source "$SHARED_ENV"
fi

[[ -z "${META_ACCESS_TOKEN:-}" ]] && fail "META_ACCESS_TOKEN missing. Add it to $SHARED_ENV or export it."
[[ -z "${ANTHROPIC_API_KEY:-}" ]] && fail "ANTHROPIC_API_KEY missing."
[[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] && fail "CLOUDFLARE_API_TOKEN missing."
[[ -z "${CLOUDFLARE_ZONE_ID:-}" ]] && fail "CLOUDFLARE_ZONE_ID missing."
[[ -z "${TUNNEL_ID:-}" ]] && fail "TUNNEL_ID missing."

# ---------- Step 1: clone repo ----------
log "Step 1/10 · Cloning $REPO_URL → $CLIENT_DIR"
mkdir -p "$CLIENTS_DIR"
git clone --depth 1 "$REPO_URL" "$CLIENT_DIR"

# ---------- Step 2: write .env ----------
log "Step 2/10 · Writing $CLIENT_DIR/.env"
cat > "$CLIENT_DIR/.env" <<EOF
# Generated by provision-client.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
CLIENT_NAME=$NAME
CLIENT_SLUG=$SLUG
CLIENT_TAGLINE=Social Media & Ads Monitor
CLIENT_LOCATION=$LOCATION
CLIENT_DESCRIPTION=$DESCRIPTION

BRAND_COLOR=$BRAND_COLOR
BRAND_COLOR_DEEP=$BRAND_COLOR_DEEP

META_ACCESS_TOKEN=$META_ACCESS_TOKEN
INSTAGRAM_ACCOUNT_ID=$IG_ID
FACEBOOK_PAGE_ID=$FB_ID
AD_ACCOUNT_ID=$AD_ACCOUNT
CAMPAIGN_FILTER=$FILTER

ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
INSIGHTS_WINDOW_DAYS=30
INSIGHTS_CRON=0 11 * * *

PORT=$PORT
DB_NAME=${SLUG}.db
EOF
chmod 600 "$CLIENT_DIR/.env"

# ---------- Step 3: copy logo ----------
if [[ -n "$LOGO" && -f "$LOGO" ]]; then
  log "Step 3/10 · Copying logo → $CLIENT_DIR/public/logo.jpg"
  cp "$LOGO" "$CLIENT_DIR/public/logo.jpg"
else
  warn "Step 3/10 · No logo provided, keeping default"
fi

# ---------- Step 4: npm install ----------
log "Step 4/10 · npm install (this may take ~1 min)"
cd "$CLIENT_DIR"
npm install --omit=dev --silent

# ---------- Step 5: init DB ----------
log "Step 5/10 · Initializing SQLite database"
node -e "require('./src/db/database').getDb(); console.log('  DB ready.');"

# ---------- Step 6: start PM2 ----------
log "Step 6/10 · Starting PM2 process: ${SLUG}-monitor on port $PORT"
pm2 delete "${SLUG}-monitor" 2>/dev/null || true
pm2 start src/server.js --name "${SLUG}-monitor" --update-env
pm2 save

# ---------- Step 7: cloudflared ingress ----------
log "Step 7/10 · Adding ingress rule to $CLOUDFLARED_CONFIG"
if grep -q "$SUBDOMAIN" "$CLOUDFLARED_CONFIG" 2>/dev/null; then
  warn "Subdomain $SUBDOMAIN already in cloudflared config — skipping"
else
  # Insert before the catchall (- service: http_status:404) line
  python3 - <<PYEOF
import re, sys
path = "$CLOUDFLARED_CONFIG"
new_entry = """  - hostname: $SUBDOMAIN
    service: http://127.0.0.1:$PORT
"""
with open(path, "r") as f:
    content = f.read()
# insert before catchall
pattern = re.compile(r"^(\s*-\s+service:\s+http_status:404)", re.MULTILINE)
match = pattern.search(content)
if match:
    new_content = content[:match.start()] + new_entry + content[match.start():]
    with open(path, "w") as f:
        f.write(new_content)
    print("  Inserted before catchall.")
else:
    # No catchall, just append
    with open(path, "a") as f:
        f.write("\n" + new_entry)
    print("  Appended (no catchall found).")
PYEOF
  systemctl restart cloudflared || warn "cloudflared restart returned non-zero"
fi

# ---------- Step 8: Cloudflare DNS CNAME ----------
log "Step 8/10 · Creating Cloudflare CNAME: $SUBDOMAIN → ${TUNNEL_ID}.cfargotunnel.com"
DNS_RECORD_NAME="${SUBDOMAIN%%.*}"  # extract leftmost label
DNS_PAYLOAD=$(cat <<JSON
{
  "type":"CNAME",
  "name":"$DNS_RECORD_NAME",
  "content":"${TUNNEL_ID}.cfargotunnel.com",
  "ttl":1,
  "proxied":true
}
JSON
)
DNS_RESULT=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$DNS_PAYLOAD")
DNS_OK=$(echo "$DNS_RESULT" | jq -r '.success // false')
if [[ "$DNS_OK" != "true" ]]; then
  ERR_MSG=$(echo "$DNS_RESULT" | jq -r '.errors[]? | "\(.code): \(.message)"' | head -1)
  if echo "$ERR_MSG" | grep -q "already exists\|81057\|81053"; then
    warn "DNS record already exists — leaving as is"
  else
    fail "Cloudflare DNS creation failed: $ERR_MSG"
  fi
fi

# ---------- Step 9: trigger initial sync ----------
log "Step 9/10 · Waiting 5s for service to settle then triggering initial sync"
sleep 5
SYNC_RESULT=$(curl -s -m 30 -X POST "http://127.0.0.1:${PORT}/api/sync" || echo '{"error":"unreachable"}')
echo "  Sync response: $SYNC_RESULT" | head -c 300; echo

# ---------- Step 10: verify URL ----------
log "Step 10/10 · Verifying https://$SUBDOMAIN responds"
sleep 10  # let DNS propagate
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$SUBDOMAIN/api/health" || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  log "✓ https://$SUBDOMAIN/api/health returned HTTP 200"
else
  warn "Got HTTP $HTTP_CODE from https://$SUBDOMAIN — DNS may still be propagating (try again in 30s)"
fi

# ---------- Summary ----------
echo
echo "════════════════════════════════════════════════════════════════"
echo " Client provisioned successfully"
echo "════════════════════════════════════════════════════════════════"
echo "  Name:        $NAME"
echo "  Slug:        $SLUG"
echo "  Folder:      $CLIENT_DIR"
echo "  Dashboard:   https://$SUBDOMAIN"
echo "  PM2:         ${SLUG}-monitor (port $PORT)"
echo "  DB:          $CLIENT_DIR/data/${SLUG}.db"
echo "  Logs:        pm2 logs ${SLUG}-monitor"
echo "════════════════════════════════════════════════════════════════"
