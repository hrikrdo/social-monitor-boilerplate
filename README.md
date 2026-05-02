# Social Monitor — Multi-Tenant Boilerplate

A self-hosted dashboard that monitors a brand's Instagram + Facebook comments and Meta Ads performance, with daily AI-generated content insights powered by Claude.

Built to be cloned per client. One isolated instance per brand on a single VPS.

## What it does

- Syncs Instagram + Facebook posts and comments hourly via the Meta Graph API.
- Pulls Meta Ads campaign, ad set, and ad-level insights (spend, reach, impressions, clicks, video retention).
- Classifies comments into sentiment (positive / negative / neutral) and intent categories using a Spanish keyword model.
- Generates a daily content-strategy briefing with Claude (top themes, frequent questions, content ideas).
- Renders an editorial-style dashboard with light/dark mode, sparklines, conversion funnel, signature cards, and auto-detected action items.

## Architecture

```
Internet
   |
   v
Cloudflare Tunnel  (one tunnel, many hostnames)
   |
   +-- client-a.yourdomain.com -> 127.0.0.1:3002 -> PM2: client-a-monitor
   +-- client-b.yourdomain.com -> 127.0.0.1:3003 -> PM2: client-b-monitor
   +-- client-c.yourdomain.com -> 127.0.0.1:3004 -> PM2: client-c-monitor

Each PM2 process:
  /opt/clients/<slug>/
    .env            (per-client credentials)
    data/<slug>.db  (per-client SQLite database)
    src/            (shared boilerplate code)
    public/         (dashboard frontend)
```

Each client is fully isolated:
- Separate SQLite database
- Separate process
- Separate port
- Separate subdomain
- Separate `.env` (credentials, brand colors, IG/FB IDs, ad account)

## Tech stack

- Node.js 20+ / Express
- SQLite (better-sqlite3) with WAL journal mode
- node-cron (hourly sync, daily insights)
- Anthropic Claude (`claude-sonnet-4-5`) with prompt caching
- Chart.js for visualizations
- Inter / Inter Tight typography
- PM2 for process management
- Cloudflare Tunnel + Cloudflare DNS

## Prerequisites

### On the VPS

- Ubuntu 20.04+ (or any Linux with systemd)
- Node 20+, npm
- pm2 (`npm i -g pm2`)
- git, jq, curl, python3
- cloudflared installed and running with a tunnel configured at `/etc/cloudflared/config.yml`
- A domain you control, with its DNS managed by Cloudflare

### Per client

You'll need from the client:
1. **Partner Access** to their Meta Business Manager (recommended) — they grant your Business Manager access to their Page, Instagram and Ad Account. Or:
2. **Their own Meta App + System User Token** if they prefer to keep credentials separate.

You'll need to know:
- Their Instagram Business Account ID
- Their Facebook Page ID
- Their Meta Ad Account ID
- A keyword that appears in their campaign names (used as filter — leave empty to sync ALL campaigns on the ad account)
- Their brand colors (hex)
- Their logo (square jpg/png)

## Quickstart — single client (manual)

```bash
git clone https://github.com/hrikrdo/social-monitor-boilerplate.git client-a
cd client-a
cp .env.example .env
# Edit .env with the client's credentials
nano .env

npm install
node -e "require('./src/db/database').getDb()"
PORT=3003 npm start
```

Open `http://localhost:3003` and sync.

## Production setup — multi-tenant on a VPS

### 1. One-time VPS prep

```bash
# Create base structure
sudo mkdir -p /opt/clients/.shared
sudo chmod 700 /opt/clients/.shared

# Place your shared secrets file
sudo nano /opt/clients/.shared/shared.env
# (paste contents from scripts/shared.env.example, fill in your tokens)
sudo chmod 600 /opt/clients/.shared/shared.env

# Confirm cloudflared is running
systemctl status cloudflared
```

### 2. Provision a new client

```bash
sudo bash scripts/provision-client.sh \
  --slug acme \
  --name "Acme Corp" \
  --location "Panama" \
  --description "una empresa de servicios automotrices" \
  --port 3003 \
  --subdomain acme.yourdomain.com \
  --ig-id 17841438563211668 \
  --fb-id 1136563066196013 \
  --ad-account 1581082383118273 \
  --filter acme \
  --logo /tmp/acme-logo.jpg \
  --brand-color "#0066ff" \
  --brand-color-deep "#001e4d"
```

The script will:
1. Clone the repo to `/opt/clients/acme/`
2. Generate `.env` from your inputs + shared secrets
3. Copy the logo
4. `npm install`
5. Initialize the SQLite DB
6. Start a PM2 process `acme-monitor` on port 3003
7. Add `acme.yourdomain.com -> 127.0.0.1:3003` to `cloudflared/config.yml`
8. Create the Cloudflare DNS CNAME via API
9. Trigger the initial sync
10. Health-check the live URL

About 30-45 seconds end to end.

Or run with no flags to be prompted interactively:

```bash
sudo bash scripts/provision-client.sh
```

### 3. Decommission a client

```bash
SLUG=acme

# Stop and remove the process
pm2 delete ${SLUG}-monitor && pm2 save

# Remove the cloudflared ingress entry (manual edit)
sudo nano /etc/cloudflared/config.yml
sudo systemctl restart cloudflared

# Delete the Cloudflare DNS record (via dashboard or API)

# Archive then remove the folder
sudo tar -czf /backup/${SLUG}-$(date +%Y%m%d).tar.gz /opt/clients/${SLUG}
sudo rm -rf /opt/clients/${SLUG}
```

## Environment variables

See `.env.example` for the per-client config. Highlights:

| Variable | Required | Purpose |
|---|---|---|
| `CLIENT_NAME` | yes | Display name in the dashboard header |
| `CLIENT_SLUG` | yes | Used for DB filename, PM2 name, folder name |
| `CLIENT_LOCATION` | no | Used in AI prompt context |
| `CLIENT_DESCRIPTION` | no | 1-line description used in AI prompt |
| `BRAND_COLOR` | no | Hex color for accents (default `#00d750`) |
| `BRAND_COLOR_DEEP` | no | Hex color for signature card backgrounds |
| `META_ACCESS_TOKEN` | yes | System User token from Meta Business Manager |
| `INSTAGRAM_ACCOUNT_ID` | yes | Client's IG Business Account ID |
| `FACEBOOK_PAGE_ID` | yes | Client's FB Page ID |
| `AD_ACCOUNT_ID` | yes | Client's Meta Ad Account (no `act_` prefix) |
| `CAMPAIGN_FILTER` | no | Substring to filter campaign names (empty = all) |
| `ANTHROPIC_API_KEY` | yes | Claude API key for daily insights |
| `INSIGHTS_WINDOW_DAYS` | no | How many days of comments to analyze (default 30) |
| `INSIGHTS_CRON` | no | When to generate insights (default `0 11 * * *` = 6 AM Panama) |
| `PORT` | yes | Each client must use a unique port |
| `DB_NAME` | no | Defaults to `${CLIENT_SLUG}.db` |

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | `{ status: "ok", client, port }` — for monitoring |
| `/api/config` | GET | Public client branding info (used by frontend) |
| `/api/dashboard` | GET | Aggregated KPIs for the Overview tab |
| `/api/posts` | GET | Posts with comment counts |
| `/api/comments` | GET | Comments filtered by post / sentiment / category |
| `/api/campaigns` | GET | Campaign-level ads data |
| `/api/ads` | GET | All ads |
| `/api/ads-grouped` | GET | Ads grouped by creative name |
| `/api/daily-insights` | GET | Daily aggregated metrics |
| `/api/sentiment-timeline` | GET | Sentiment trend over time |
| `/api/insights` | GET | Latest Claude AI insights |
| `/api/insights/regenerate` | POST | Trigger a new AI analysis |
| `/api/insights/status` | GET | Polling: is generation in progress |
| `/api/sync` | POST | Trigger manual sync (non-blocking) |
| `/api/sync-status` | GET | Polling: is sync in progress |

## Cron jobs (auto-configured per process)

- **Hourly sync** — pulls fresh posts, comments and ad metrics from Meta.
- **Daily insights** — runs once per day (default 6 AM Panama) to generate the AI-powered content briefing.

## Backup recommendation

Add a daily VPS-level cron to back up all client databases:

```bash
# /etc/cron.d/social-monitor-backup
0 3 * * * root tar -czf /backup/clients-$(date +\%Y\%m\%d).tar.gz /opt/clients/*/data/
```

## Updating the boilerplate

When you push improvements to this repo, propagate to clients:

```bash
for dir in /opt/clients/*/; do
  slug=$(basename "$dir")
  [[ "$slug" == ".shared" ]] && continue
  echo "Updating $slug..."
  cd "$dir" && git pull --rebase && npm install --omit=dev
  pm2 restart "${slug}-monitor"
done
```

## Security notes

- `.env` files are `chmod 600`, never committed to git.
- The shared `META_ACCESS_TOKEN` should be a System User token (no expiration). If you lose it, every client breaks until you rotate.
- The Anthropic key is shared across clients — costs are pooled. If you want per-client billing, give each their own key in their `.env`.
- The Cloudflare API token only needs `Zone.DNS.Edit` on the specific zone.
- All traffic between client browser and origin is HTTPS via Cloudflare Tunnel; the VPS does not expose any port directly.

## License

MIT
