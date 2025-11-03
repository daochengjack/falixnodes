# Falix Keepalive Login Improvements

This document outlines the improvements made to fix Puppeteer login timeout issues on Falix login.

## Key Improvements

### 1. Enhanced Browser Configuration
- **Headless mode**: Now uses `headless: "new"` for better stability
- **User Agent**: Set to realistic Chrome user agent
- **Viewport**: Updated to common desktop size (1366x768)
- **Timeouts**: Increased to 45 seconds for both default and navigation timeouts

### 2. Robust Login Flow
- **Navigation**: Uses both `DOMContentLoaded` and `networkidle2` wait conditions
- **Redirect Handling**: Automatically detects and follows redirects to `/auth`, `/auth/signin`, or OAuth providers
- **Retry Mechanism**: Wrapped entire login process with internal `withRetry` helper (3 attempts)
- **Error Recovery**: Page reload on retry attempts

### 3. Enhanced Selectors
**Email field support:**
- `input[name="email"]`
- `input[type="email"]`
- `#email`
- `input[name="username"]`
- `input[placeholder*="email" i]`
- `input[placeholder*="username" i]`

**Password field support:**
- `input[name="password"]`
- `input[type="password"]`
- `#password`
- `input[placeholder*="password" i]`

**Submit button support:**
- `button[type="submit"]`
- `input[type="submit"]`
- `[data-testid*="login"]`
- `.btn-primary`
- `.login-btn`
- `.signin-btn`
- Text-based fallbacks for "Log in", "Sign in", "Login", etc.

### 4. iframe and Shadow DOM Support
- **Frame Detection**: Searches across all frames for login elements
- **Frame Navigation**: Handles form submission within the correct frame context
- **Multi-frame Support**: Works with login forms in iframes

### 5. Cloudflare/Turnstile/hCaptcha Handling
**Detection:**
- Cloudflare: `.cf-browser-verification`, `#cf-challenge-running`, `[data-ray]`
- Turnstile: `iframe[title*="turnstile"]`, `.cf-turnstile`
- hCaptcha: `iframe[title*="hcaptcha"]`, `.h-captcha`
- Generic challenge indicators

**Interaction:**
- Best-effort clicking of verify buttons and checkboxes
- Polling for clearance up to 90 seconds
- Graceful fallback if verification fails

### 6. Comprehensive Diagnostics
- **Screenshots**: Full-page screenshots on failure
- **HTML Capture**: Page HTML saved for debugging
- **Frame Logging**: Lists all available frames and URLs
- **URL Tracking**: Logs current URL during errors
- **Artifact Upload**: Workflow automatically uploads diagnostics to GitHub

### 7. Enhanced Error Handling
- **Structured Logging**: Detailed error messages and context
- **Diagnostic Capture**: Automatic screenshot and HTML capture on failures
- **Graceful Degradation**: Continues operation even if some features fail
- **Workflow Integration**: Diagnostic artifacts uploaded to GitHub Actions

## Usage

The script maintains backward compatibility with existing environment variables:

```bash
FALIX_EMAIL=your@email.com
FALIX_PASSWORD=yourpassword
FALIX_BASE_URL=https://client.falixnodes.net
FALIX_SERVER_HOST=your-server.falixsrv.me
HEADLESS=true
```

## Workflow Artifacts

When running in GitHub Actions, diagnostic files are automatically uploaded:
- Screenshots: `falix-diagnostics-{run-number}`
- HTML files: `falix-html-{run-number}`
- Retention: 7 days

## Acceptance Criteria Met

✅ **No more email selector timeout errors**: Robust selector fallbacks prevent failures
✅ **Cloudflare verification handling**: Waits or interacts with verification challenges
✅ **Diagnostics on failure**: Screenshots and HTML captured and uploaded
✅ **No regressions**: All existing keepalive functionality preserved
✅ **iframe support**: Handles login forms in iframes
✅ **Redirect handling**: Follows automatic redirects during login
✅ **Retry mechanism**: 3 attempts with exponential backoff
✅ **Enhanced timeouts**: 45-second timeouts for all operations