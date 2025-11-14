# Auto-Timer Feature Documentation

## Overview

The auto-timer feature provides HTTP-based automatic timer extension for FalixNodes servers. It complements the existing browser-based keepalive by sending periodic GET requests to the Falix timer endpoint.

## How It Works

### Architecture

The auto-timer operates independently of the browser-based keepalive:

1. **HTTP Requests**: Sends GET requests to `https://client.falixnodes.net/timer?id={serverId}`
2. **Session Cookies**: Reuses saved cookies from browser login for authentication
3. **Periodic Execution**: Runs on a configurable interval (default: 1 hour)
4. **Parallel Operation**: Runs alongside the browser-based keepalive without interference

### Request Details

Each timer request includes:

- **Method**: GET
- **URL**: `https://client.falixnodes.net/timer?id={serverId}`
- **Headers**:
  - `User-Agent`: Chrome 120 Windows user agent
  - `Accept`: HTML/XHTML content types
  - `Accept-Language`: en-US,en
  - `Accept-Encoding`: gzip, deflate, br
  - `Connection`: keep-alive
  - `Sec-Fetch-*`: Browser security headers
  - `Cookie`: Session cookies from browser login (if available)
  - `Referer`: Timer URL itself

### Response Handling

- **2xx (Success)**: Timer extended successfully
- **401/403 (Auth Required)**: Session expired; browser keepalive will handle re-authentication
- **Other**: Logged as warning; retries on next interval
- **Network Errors**: Automatic retry with exponential backoff (up to 3 attempts)

## Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FALIX_SERVER_ID` | String | Required* | Your Falix server ID |
| `TIMER_INTERVAL` | Integer | 3600 | Timer interval in seconds |
| `TIMER_ENABLE` | Boolean | true | Enable/disable auto-timer |

*Falls back to `FALIX_TIMER_ID`, config file, or interactive prompt if not set.

### Accepted Boolean Values

`TIMER_ENABLE` accepts:
- **True**: `true`, `1`, `yes`, `y`, `on`
- **False**: `false`, `0`, `no`, `n`, `off`
- Case-insensitive

### Configuration File

Create `falix.config.json` in the project root:

```json
{
  "serverId": "your-server-id",
  "FALIX_SERVER_ID": "your-server-id"
}
```

The script will search for these keys (in order):
1. `serverId`
2. `ServerId`
3. `SERVER_ID`
4. `falixServerId`
5. `falix_server_id`
6. `FALIX_SERVER_ID`
7. `timerId`
8. `FALIX_TIMER_ID`

### Interactive Prompt

When running locally (not in CI), if no server ID is found, the script will prompt:

```
Please enter your Falix Server ID: _
```

The entered ID is saved to `falix.config.json` for future use.

## Usage Examples

### Enable Auto-Timer (Default)

```bash
export FALIX_EMAIL="your-email@example.com"
export FALIX_PASSWORD="your-password"
export FALIX_SERVER_ID="your-server-id"
npm run keepalive
```

### Custom Interval (30 minutes)

```bash
export TIMER_INTERVAL="1800"  # 30 minutes
npm run keepalive
```

### Disable Auto-Timer

```bash
export TIMER_ENABLE="false"
npm run keepalive
```

### Use Config File

```bash
echo '{"serverId": "123456"}' > falix.config.json
npm run keepalive
```

## GitHub Actions Setup

Add to your repository secrets:

```yaml
FALIX_SERVER_ID: "your-server-id"
TIMER_INTERVAL: "3600"  # Optional
TIMER_ENABLE: "true"    # Optional
```

The workflow is already configured to use these values.

## Logging

The auto-timer logs detailed information:

### Success
```
[2024-01-15T12:00:00.000Z] Sending timer extension request to: https://client.falixnodes.net/timer?id=123456 (attempt 1/3)
[2024-01-15T12:00:01.234Z] ✓ Timer extension request successful (status: 200)
✓ Auto-timer successfully extended server time
```

### Authentication Required
```
[2024-01-15T12:00:01.234Z] ⚠ Timer request returned 401 - Authentication may be required
⚠ Auto-timer failed: Authentication required. Browser-based keepalive will handle this.
```

### Network Error with Retry
```
[2024-01-15T12:00:00.000Z] Sending timer extension request to: https://client.falixnodes.net/timer?id=123456 (attempt 1/3)
[2024-01-15T12:00:15.000Z] ✗ Timer request timed out: timeout of 15000ms exceeded
Retrying in 2123ms... (attempt 2/3)
```

### Startup Messages
```
=== Starting Auto-Timer ===
Server ID: 123456
Interval: 3600 seconds (60 minutes)
Timer endpoint: https://client.falixnodes.net/timer?id=123456
Auto-timer started - will run every 3600 seconds
```

## Error Handling

### Retry Logic

The auto-timer implements exponential backoff:
- **Attempt 1**: Initial request
- **Attempt 2**: Retry after ~2-3 seconds
- **Attempt 3**: Retry after ~3-4 seconds
- **Failed**: Log error and wait for next interval

### Network Errors

Handled errors:
- Connection timeout (`ETIMEDOUT`)
- Connection aborted (`ECONNABORTED`)
- No response received
- HTTP error responses

All errors are logged with timestamps for debugging.

### Graceful Degradation

If the auto-timer fails:
1. Error is logged
2. Timer continues on schedule
3. Browser-based keepalive remains operational
4. Next interval attempt will be made

## Integration with Browser Keepalive

Both systems work together:

1. **Browser Login**: Saves session cookies
2. **Auto-Timer**: Reuses cookies for HTTP requests
3. **Session Expiry**: Auto-timer detects and logs
4. **Browser Re-auth**: Next browser run re-authenticates
5. **Cookies Updated**: Auto-timer uses fresh cookies

## Troubleshooting

### Auto-Timer Not Starting

**Symptom**: No auto-timer logs
**Solutions**:
1. Check `TIMER_ENABLE` is not set to false
2. Verify `FALIX_SERVER_ID` is set
3. Ensure config file exists with valid server ID

### Authentication Errors (401/403)

**Symptom**: `⚠ Timer request returned 401`
**Explanation**: Session cookies expired or invalid
**Action**: Normal behavior; browser keepalive will re-authenticate

### Timer Interval Not Respected

**Symptom**: Requests too frequent or infrequent
**Solutions**:
1. Check `TIMER_INTERVAL` value (in seconds)
2. Verify environment variable is being read
3. Check for typos in variable name

### Network Timeouts

**Symptom**: `✗ Timer request timed out`
**Solutions**:
1. Check network connectivity
2. Verify Falix service is accessible
3. Check firewall settings
4. Automatic retries will handle temporary issues

## Security Considerations

1. **Credentials**: Only `FALIX_EMAIL` and `FALIX_PASSWORD` are sensitive
2. **Server ID**: Not sensitive; visible in URL
3. **Session Cookies**: Stored in `/tmp/falix-cookies.json`
4. **Config File**: Added to `.gitignore`; not committed to repository

## Performance

- **Memory**: Minimal overhead (~1-2 MB for axios)
- **CPU**: Negligible during idle; brief spike during requests
- **Network**: One GET request per interval (~1 KB per request)
- **Impact**: No impact on browser-based keepalive performance

## Limitations

1. **Authentication**: Cannot perform initial login; relies on browser session
2. **Cloudflare**: May fail if Cloudflare challenges are required
3. **Session Lifetime**: Depends on Falix session management
4. **Interval**: Minimum practical interval is ~60 seconds (avoid rate limiting)

## Future Enhancements

Potential improvements:
- [ ] Support for multiple server IDs
- [ ] Configurable retry strategy
- [ ] Health check endpoint
- [ ] Metrics/statistics collection
- [ ] Webhook notifications on failure

## Technical Details

### Dependencies

- `axios`: ^1.6.2 (HTTP client)
- Existing: `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`

### Files Modified

- `scripts/falix-keepalive.js`: Main implementation
- `package.json`: Added axios dependency
- `.github/workflows/falix-keepalive.yml`: Added environment variables
- `.gitignore`: Added config file
- `README.md`: Updated documentation

### Functions Added

- `sendTimerRequest(serverId, attempt)`: Sends HTTP timer request
- `startAutoTimer(serverId)`: Starts periodic timer
- `stopAutoTimer()`: Stops periodic timer
- `getServerIdWithFallback()`: Resolves server ID from multiple sources
- `loadConfigFile()`: Loads config from JSON file
- `saveConfigFile(configData)`: Saves config to JSON file
- `promptForServerId()`: Interactive prompt for server ID
- `parseBooleanEnv(value, defaultValue)`: Parses boolean environment variables
- `parsePositiveIntEnv(value, defaultValue)`: Parses positive integer environment variables

### Code Organization

```
scripts/falix-keepalive.js
├── Imports (axios, puppeteer, etc.)
├── Constants (timeouts, defaults, etc.)
├── Helper Functions
│   ├── Cookie management
│   ├── Config file I/O
│   ├── Server ID resolution
│   └── Environment variable parsing
├── Auto-Timer Functions
│   ├── sendTimerRequest()
│   ├── startAutoTimer()
│   └── stopAutoTimer()
├── Browser Automation Functions
│   └── (existing browser-based keepalive)
└── Main Entry Point
    ├── Resolve server ID
    ├── Start auto-timer (if enabled)
    ├── Run browser keepalive
    └── Cleanup
```

## Support

For issues or questions:
1. Check logs for detailed error messages
2. Verify environment variables are set correctly
3. Ensure `falix.config.json` syntax is valid JSON
4. Test with `TIMER_ENABLE=false` to isolate issues
5. Review GitHub Actions workflow logs

## License

MIT License - Same as main project
