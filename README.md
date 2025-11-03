# Falix Keepalive Bot

An automated bot that monitors and keeps your Falix server online by automatically starting it when it goes offline.

## Features

- Automatically logs into your Falix account using credentials
- Monitors server status every 2 minutes
- Automatically starts the server when it detects it's offline
- Handles ad modal workflows (waits 35 seconds for ads)
- Robust error handling with retry logic
- Cloudflare verification handling
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
| `CHECK_INTERVAL_MS` | `120000` | Interval between checks in milliseconds (2 minutes) |
| `AD_WATCH_MS` | `35000` | Duration to wait for ads in milliseconds (35 seconds) |
| `HEADLESS` | `true` | Whether to run browser in headless mode |

## How It Works

1. **Login**: The bot logs into your Falix account using the provided credentials
2. **Cloudflare Handling**: If Cloudflare verification appears, it waits for it to complete
3. **Status Check**: Navigates to the dashboard and checks if the specified server is offline
4. **Auto-Start**: If the server is offline, it navigates to the console and clicks Start
5. **Ad Handling**: If an ad modal appears, it watches the ad for the specified duration
6. **Monitoring**: Continues checking every 2 minutes for the duration of the workflow

## Troubleshooting

### Common Issues

1. **Login Failures**: Verify your credentials are correct and that your account is in good standing
2. **Server Not Found**: Ensure the `FALIX_SERVER_HOST` matches exactly what appears in your dashboard
3. **Cloudflare Issues**: The bot includes retry logic for Cloudflare verification
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