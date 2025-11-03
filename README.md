# Falix Keepalive Bot

An automated bot that monitors and keeps your Falix server online by automatically starting it when it goes offline.

## Features

- Automatically logs into your Falix account using credentials
- Monitors server status every 2 minutes
- Automatically starts the server when it detects it's offline
- Handles ad modal workflows (waits 35 seconds for ads)
- Robust error handling with retry logic
- Gracefully skips runs when Cloudflare challenges appear
- GitHub Actions workflow for scheduled runs

## Setup

### 1. Repository Secrets

Add the following secrets to your GitHub repository:

**Required:**
- `FALIX_EMAIL`: Your Falix account email
- `FALIX_PASSWORD`: Your Falix account password

**Optional:**
- `FALIX_BASE_URL`: Base URL (default: `https://client.falixnodes.net`)
- `FALIX_SERVER_HOST`: Server hostname to monitor (default: `mikeqd.falixsrv.me`)
- `FALIX_SERVER_NAME`: Server display name for matching (alternative/additional to host)
- `FALIX_CONSOLE_URL`: Direct console URL to bypass dashboard (default: `<BASE_URL>/server/console`)
- `CHECK_INTERVAL_MS`: Check interval in milliseconds (default: `120000`)
- `AD_WATCH_MS`: Ad watch duration in milliseconds (default: `35000`)
- `HEADLESS`: Run in headless mode (default: `true`)

### 2. Local Development

Install dependencies:
```bash
npm install
```

Set environment variables:
```bash
export FALIX_EMAIL="your-email@example.com"
export FALIX_PASSWORD="your-password"
# Optional overrides
export FALIX_SERVER_HOST="your-server.falixsrv.me"
export CHECK_INTERVAL_MS="120000"
export HEADLESS="true"
```

Run the script:
```bash
npm run keepalive
```

### 3. GitHub Actions

The workflow is configured to:
- Run every 5 minutes via cron schedule (`*/5 * * * *`)
- Allow manual dispatch via workflow_dispatch
- Perform 5 status checks (approximately 10 minutes of monitoring)
- Use npm ci for reliable dependency installation

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FALIX_EMAIL` | - | Your Falix account email (required) |
| `FALIX_PASSWORD` | - | Your Falix account password (required) |
| `FALIX_BASE_URL` | `https://client.falixnodes.net` | Falix client base URL |
| `FALIX_SERVER_HOST` | `mikeqd.falixsrv.me` | Server hostname to monitor |
| `FALIX_SERVER_NAME` | - | Server display name for matching (optional) |
| `FALIX_CONSOLE_URL` | `<BASE_URL>/server/console` | Direct console URL to bypass dashboard (optional) |
| `CHECK_INTERVAL_MS` | `120000` | Interval between checks in milliseconds (2 minutes) |
| `AD_WATCH_MS` | `35000` | Duration to wait for ads in milliseconds (35 seconds) |
| `HEADLESS` | `true` | Whether to run browser in headless mode |

## How It Works

1. **Login**: The bot logs into your Falix account using the provided credentials
2. **Cloudflare Detection**: If a Cloudflare challenge appears, the run is skipped so the scheduler can retry later
3. **Server Detection** (two strategies):
   - **Direct Console**: If `FALIX_CONSOLE_URL` is explicitly provided, navigates directly to console and validates by checking for Start/Stop controls and matching server name/host
   - **Dashboard Fallback**: If direct console fails or not configured, navigates to dashboard, scrolls to load all servers, collects server cards/rows, and matches by exact host (`FALIX_SERVER_HOST`) or display name (`FALIX_SERVER_NAME`, case-insensitive)
4. **Status Check**: Determines if server is offline by analyzing status indicators, button controls, and text content
5. **Auto-Start**: If the server is offline, navigates to console and clicks Start
6. **Ad Handling**: If an ad modal appears, watches the ad for the specified duration
7. **Monitoring**: Continues checking every 2 minutes for the duration of the workflow

### Server Matching

The bot can match servers by:
- **Host**: Exact match of `FALIX_SERVER_HOST` (e.g., `mikeqd.falixsrv.me`)
- **Display Name**: Case-insensitive match of `FALIX_SERVER_NAME` (e.g., `My Server`)

When a server is not found, the bot logs all detected servers with their hosts, names, and statuses for troubleshooting.

## Troubleshooting

### Common Issues

1. **Login Failures**: Verify your credentials are correct and that your account is in good standing
2. **Server Not Found**: Ensure the `FALIX_SERVER_HOST` matches exactly what appears in your dashboard
3. **Cloudflare Challenges**: The bot does not attempt to solve Cloudflare challenges. When detected, it exits gracefully and the scheduled job will retry later when the challenge may be absent
4. **Timeout Issues**: Adjust timeout values if you have a slow connection

### Debug Mode

Set `HEADLESS=false` to watch the bot's actions in a visible browser window for debugging.

## Dependencies

- `puppeteer`: Browser automation
- `puppeteer-extra`: Enhanced Puppeteer functionality
- `puppeteer-extra-plugin-stealth`: Avoid detection
- Internal withRetry helper (no p-retry dependency)

## License

MIT