# Falix Timer Keepalive Bot

An automated bot that keeps your Falix timer alive using both HTTP-based auto-timer requests and browser-based clicking.

## Features

### Auto-Timer (HTTP-based)
- **Automatic timer extension** via direct HTTP GET requests to `https://client.falixnodes.net/timer?id={serverId}`
- **Configurable interval**: Run every N seconds (default: 3600 seconds = 1 hour)
- **Real browser headers**: Mimics authentic browser requests with User-Agent, Referer, and standard headers
- **Retry mechanism**: Automatic retries with exponential backoff on failure
- **Session-aware**: Reuses saved session cookies and gracefully reports when authentication is required
- **Runs alongside browser-based keepalive**: Both methods work together seamlessly

### Browser-Based Keepalive
- Automatically logs into your Falix account using credentials
- Navigates to timer page and clicks "Add time" button
- Verifies success through toast messages, button state, or countdown changes
- Retry logic with exponential backoff for click operations
- Robust error handling with diagnostic screenshots
- Gracefully skips runs when Cloudflare challenges appear
- GitHub Actions workflow for scheduled runs every 40 minutes

## Setup

### 1. Repository Secrets

Add the following secrets to your GitHub repository:

**Required:**
- `FALIX_EMAIL`: Your Falix account email
- `FALIX_PASSWORD`: Your Falix account password
- `FALIX_SERVER_ID`: Your Falix server ID (used for both auto-timer and browser keepalive)

**Optional:**
- `FALIX_BASE_URL`: Base URL (default: `https://client.falixnodes.net`)
- `TIMER_INTERVAL`: Auto-timer interval in seconds (default: `3600` = 1 hour)
- `TIMER_ENABLE`: Enable auto-timer (default: `true`)
- `CLICK_INTERVAL_MS`: Click interval in milliseconds (default: `2400000` = 40 minutes)
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
export FALIX_SERVER_ID="your-server-id"

# Optional overrides
export TIMER_INTERVAL="3600"  # 1 hour
export TIMER_ENABLE="true"
export CLICK_INTERVAL_MS="2400000"
export HEADLESS="true"
```

Run the script:
```bash
npm run keepalive
```

### 3. Configuration File (Alternative to Environment Variables)

If `FALIX_SERVER_ID` is not set as an environment variable, the script can:
1. Load it from a `falix.config.json` file in the project root
2. Prompt for it interactively (local development only)

Example `falix.config.json`:
```json
{
  "serverId": "your-server-id",
  "FALIX_SERVER_ID": "your-server-id"
}
```

### 4. GitHub Actions

The workflow is configured to:
- Run every 40 minutes via cron schedule (`*/40 * * * *`)
- Allow manual dispatch via workflow_dispatch
- Perform a single timer click per run
- Use npm ci for reliable dependency installation

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FALIX_EMAIL` | - | Your Falix account email (required) |
| `FALIX_PASSWORD` | - | Your Falix account password (required) |
| `FALIX_SERVER_ID` | - | Falix server ID used for both auto-timer requests and browser keepalive (required; falls back to config/prompt when not provided) |
| `FALIX_TIMER_ID` | - | Legacy timer ID (falls back to `FALIX_SERVER_ID`; kept for backwards compatibility) |
| `FALIX_BASE_URL` | `https://client.falixnodes.net` | Falix client base URL |
| `TIMER_INTERVAL` | `3600` | Auto-timer interval in seconds |
| `TIMER_ENABLE` | `true` | Set to `false` to disable HTTP-based auto-timer |
| `CLICK_INTERVAL_MS` | `2400000` | Browser click interval in milliseconds (40 minutes) |
| `HEADLESS` | `true` | Whether to run browser in headless mode |

## How It Works

### Auto-Timer (HTTP)

1. **Server ID Resolution**: Obtains server ID from `FALIX_SERVER_ID` environment variable, config file, or interactive prompt
2. **Periodic HTTP Requests**: Sends authenticated GET requests to `https://client.falixnodes.net/timer?id={serverId}` at the configured interval
3. **Real Browser Headers**: Includes User-Agent, Accept, Accept-Language, Referer, and other standard browser headers
4. **Success Verification**: Checks HTTP response status (200-299 = success, 401/403 = auth required)
5. **Error Handling**: Automatic retry with exponential backoff on network errors or timeouts
6. **Logging**: Timestamps and status for each request (✓ success, ⚠ warning, ✗ error)

### Browser-Based Keepalive

1. **Login**: The bot logs into your Falix account using the provided credentials
2. **Cloudflare Detection**: If a Cloudflare challenge appears, the run is skipped so the scheduler can retry later
3. **Timer Page Navigation**: Navigates to `https://client.falixnodes.net/timer?id={serverId}`
4. **Button Detection**: Searches for the "Add time" button using multiple selector strategies:
   - Text-based matching (supports "Add time" and "添加时间")
   - Data attribute selectors (`[data-testid*="add-time"]`)
   - Class-based selectors (`.add-time`, `.add-time-btn`)
5. **Click with Retry**: Attempts to click the button with up to 3 retry attempts and exponential backoff
6. **Success Verification**: Confirms the click succeeded by checking for:
   - Success toast/notification messages
   - Button state changes (disabled state)
   - Button text changes (e.g., "Added" or "已添加")
   - Timer countdown display updates
7. **Logging**: Records timestamp and outcome for each run

### Click Verification

The bot verifies success through multiple indicators:
- **Toast Messages**: Success notifications with keywords like "success", "added", "time", or "成功"
- **Button State**: Checks if the button becomes disabled after clicking
- **Button Text**: Monitors for text changes indicating success
- **Timer Display**: Confirms timer countdown is visible and updated

## Troubleshooting

### Common Issues

1. **Login Failures**: Verify your credentials are correct and that your account is in good standing
2. **Timer ID Issues**: Ensure the `FALIX_TIMER_ID` corresponds to your actual timer on Falix
3. **Cloudflare Challenges**: The bot does not attempt to solve Cloudflare challenges. When detected, it exits gracefully and the scheduled job will retry later when the challenge may be absent
4. **Button Not Found**: Check diagnostic screenshots in workflow artifacts to see the timer page layout
5. **Timeout Issues**: Adjust timeout values if you have a slow connection

### Debug Mode

Set `HEADLESS=false` to watch the bot's actions in a visible browser window for debugging.

## Dependencies

- `axios`: HTTP client for auto-timer requests
- `puppeteer`: Browser automation
- `puppeteer-extra`: Enhanced Puppeteer functionality
- `puppeteer-extra-plugin-stealth`: Avoid detection
- Internal withRetry helper (no p-retry dependency)

## License

MIT