# Falix Timer Keepalive Bot

An automated bot that keeps your Falix timer alive by clicking "Add time" every 40 minutes.

## Features

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

**Optional:**
- `FALIX_BASE_URL`: Base URL (default: `https://client.falixnodes.net`)
- `FALIX_TIMER_ID`: Timer ID for the timer page (default: `2330413`)
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
# Optional overrides
export FALIX_TIMER_ID="2330413"
export CLICK_INTERVAL_MS="2400000"
export HEADLESS="true"
```

Run the script:
```bash
npm run keepalive
```

### 3. GitHub Actions

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
| `FALIX_BASE_URL` | `https://client.falixnodes.net` | Falix client base URL |
| `FALIX_TIMER_ID` | `2330413` | Timer ID for the timer page |
| `CLICK_INTERVAL_MS` | `2400000` | Click interval in milliseconds (40 minutes) |
| `HEADLESS` | `true` | Whether to run browser in headless mode |

## How It Works

1. **Login**: The bot logs into your Falix account using the provided credentials
2. **Cloudflare Detection**: If a Cloudflare challenge appears, the run is skipped so the scheduler can retry later
3. **Timer Page Navigation**: Navigates to `https://client.falixnodes.net/timer?id={FALIX_TIMER_ID}`
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

## Uptime Kuma Integration

This bot can be triggered by Uptime Kuma when your server goes down, providing automatic recovery.

### Setup

1. **Add Repository Secrets:**
   - `KUMA_PUSH_URL`: Your Uptime Kuma push URL (optional)
   - All required secrets from the main setup

2. **Configure Uptime Kuma Webhook:**
   
   In your Uptime Kuma monitor, add a webhook notification with these settings:
   
   ```bash
   # Webhook URL
   https://api.github.com/repos/daochengjack/falixnodes/dispatches
   
   # Headers
   Authorization: token YOUR_GITHUB_PERSONAL_ACCESS_TOKEN
   Accept: application/vnd.github.v3+json
   Content-Type: application/json
   
   # POST Body (for DOWN events)
   {
     "event_type": "kuma-falix-keepalive",
     "client_payload": {
       "reason": "Server DOWN - Uptime Kuma alert",
       "action": "ensure_running"
     }
   }
   ```

3. **GitHub Personal Access Token:**
   - Create a PAT with `repo` scope
   - Add it as the `Authorization` header value: `token ghp_xxxxxxxxxxxx`

### Webhook Examples

**Manual trigger via GitHub API:**
```bash
curl -X POST \
  -H "Authorization: token YOUR_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/daochengjack/falixnodes/dispatches \
  -d '{
    "event_type": "kuma-falix-keepalive",
    "client_payload": {
      "reason": "Manual test trigger",
      "action": "add_time"
    }
  }'
```

**Manual trigger via GitHub UI:**
- Go to Actions → Uptime Kuma Keepalive Trigger → Run workflow
- Optionally provide a reason for the trigger

### Action Modes

- `add_time`: Clicks "Add time" button (default)
- `ensure_running`: Ensures server is started (finds and clicks Start button if needed)

### Workflow Features

- **Concurrency Control**: Prevents overlapping runs
- **Artifact Upload**: Screenshots and logs saved for 7 days
- **Heartbeat**: Optional heartbeat sent to Kuma on success
- **Safe Screenshots**: Saved to `./screenshots/` directory

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FALIX_EMAIL` | - | Your Falix account email (required) |
| `FALIX_PASSWORD` | - | Your Falix account password (required) |
| `FALIX_BASE_URL` | `https://client.falixnodes.net` | Falix client base URL |
| `FALIX_TIMER_ID` | `2330413` | Timer ID for the timer page |
| `CLICK_INTERVAL_MS` | `2400000` | Click interval in milliseconds (40 minutes) |
| `HEADLESS` | `true` | Whether to run browser in headless mode |
| `ACTION` | `add_time` | Action mode: `add_time` or `ensure_running` |
| `CHROME_ARGS` | `--no-sandbox --disable-dev-shm-usage` | Chrome launch arguments |
| `SCREENSHOT_DIR` | `./screenshots` | Directory to save screenshots |
| `TRIGGER_REASON` | `Manual run` | Reason for triggering the workflow |
| `KUMA_PUSH_URL` | - | Uptime Kuma push URL for heartbeat (optional) |

## Dependencies

- `puppeteer`: Browser automation
- `puppeteer-extra`: Enhanced Puppeteer functionality
- `puppeteer-extra-plugin-stealth`: Avoid detection
- Internal withRetry helper (no p-retry dependency)

## License

MIT