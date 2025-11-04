# Implementation Summary: Stabilize Login Submit and Post-Login Detection

## Changes Made

This implementation addresses intermittent failures in the login flow by adding robust submission handling and post-login detection.

### New Functions Added

#### 1. `scrollIntoViewAndCheck(frame, selector)`
- Scrolls element into view using `scrollIntoView()` with smooth behavior
- Checks if element is visible (not hidden, has dimensions, opacity > 0)
- Checks if element is enabled (not disabled)
- Returns object with `visible` and `enabled` properties
- Used before typing credentials and clicking submit

#### 2. `detectChallengeOrBlock()`
- Detects presence of reCAPTCHA or Turnstile challenges
- Checks for common selectors:
  - reCAPTCHA: `iframe[src*="recaptcha"]`, `.g-recaptcha`, `[data-sitekey]`
  - Turnstile: `iframe[src*="turnstile"]`, `.cf-turnstile`, `[data-turnstile-sitekey]`
- Returns object with `detected` boolean and `type` (selector that matched)
- Called before form submission

#### 3. `waitForPostSubmitOutcome(timeout = 60000)`
- Uses `Promise.race` to wait for one of three outcomes:
  1. **Navigation**: `page.waitForNavigation()` with `domcontentloaded`
  2. **URL Change**: `page.waitForFunction()` checking if URL no longer matches `/auth(\/|$)/`
  3. **Error Message**: `page.waitForSelector()` for error elements like `[role="alert"]`, `.error`, `.toast`, etc.
- Returns object with `{ success, reason, details }`:
  - `success: true` if URL left auth page
  - `success: false` with appropriate reason for failures
- Logs starting URL, outcome type, and final URL
- Extracts error message text if error detected

#### 4. `submitLoginForm(emailElement, passwordElement, submitElement)`
- Comprehensive form submission with multiple fallback strategies
- **Pre-submission steps:**
  - Captures diagnostic info (`pre-submit`)
  - Scrolls email, password, and submit button into view
  - Checks visibility and enabled state for each element
  - Logs warnings if elements are not visible/enabled
- **Credential typing:**
  - Types email with 50ms delay per character
  - Types password with 50ms delay per character
  - Includes small delays between actions (100-300ms)
- **Challenge detection:**
  - Checks for reCAPTCHA/Turnstile before submission
  - Throws `CloudflareChallengeError` if challenge detected
  - Captures diagnostic info on challenge detection
- **Submit strategies (in order):**
  1. Regular click on submit button via Puppeteer
  2. If click fails, use `page.evaluate()` to click programmatically
  3. If no submit button or both clicks fail, press Enter on password field
- Returns boolean indicating submit success

### Modified Functions

#### `login()`
- Removed simple click-and-wait logic
- Added retry loop with up to 3 submit attempts
- For each attempt:
  1. Calls `submitLoginForm()` to type credentials and submit
  2. Calls `waitForPostSubmitOutcome()` to determine success/failure
  3. If successful, breaks out of loop
  4. If failed:
     - Logs failure reason and details
     - Captures diagnostic info (`post-submit-attempt-N`)
     - Waits with exponential backoff (1000ms * attempt number)
     - Reloads page if still on auth page
  5. If submit throws error:
     - Logs error
     - Captures diagnostic info (`submit-error-attempt-N`)
     - Applies backoff before retry
- Throws error if all 3 attempts fail
- Only proceeds to post-login checks if `loginSuccess = true`
- Removed separate handling of missing submit button (now handled in `submitLoginForm`)

## Ticket Requirements Met

### ✅ Submission Flow
- [x] Scroll elements into view and check visibility/enabled state
- [x] Type credentials with small delays (50ms per character)
- [x] Press Enter on password as fallback
- [x] Use `page.evaluate()` for clicking if regular click intercepted

### ✅ Post-Submit Waits (Race)
- [x] `Promise.race` with navigation, URL check, and error selector
- [x] Success detected by URL leaving `/auth*`
- [x] Failure detected by error alert/banner
- [x] Retry submit up to 3 attempts with exponential backoff

### ✅ Challenge/Blocks Handling
- [x] Detect reCAPTCHA and Turnstile
- [x] Log and exit gracefully with `CloudflareChallengeError`
- [x] No attempt to solve challenges

### ✅ Iframe & Navigation Guards
- [x] Form detection works in iframes (existing `findElementInFrames()`)
- [x] Submit in correct frame context (all operations use `element.frame`)
- [x] Use `domcontentloaded` instead of `networkidle*`

### ✅ Diagnostics
- [x] Screenshot and HTML before submit (`pre-submit`)
- [x] Screenshot and HTML after each failed attempt (`post-submit-attempt-N`)
- [x] Screenshot and HTML on submit errors (`submit-error-attempt-N`)
- [x] Screenshot and HTML on challenge detection (`challenge-detected`)
- [x] Log current URL and frame count (in existing `captureDiagnosticInfo()`)

## Acceptance Criteria

✅ **After submit, the script reliably detects success or surfaces clear error state**
- `waitForPostSubmitOutcome()` provides definitive success/failure with reason

✅ **No infinite waits; failures provide artifacts for debugging**
- All waits have 60000ms timeout
- Diagnostic artifacts captured at every failure point

✅ **Downstream timer-page flow executes when login succeeds**
- Login function only completes if `loginSuccess = true`
- Errors thrown prevent downstream execution

## Testing Recommendations

1. Test with valid credentials to verify successful login flow
2. Test with invalid credentials to verify error detection
3. Test on page with reCAPTCHA/Turnstile to verify challenge detection
4. Test with slow/flaky network to verify retries and backoff
5. Verify diagnostic artifacts are created in `/tmp/` directory
6. Check that frame detection works for forms in iframes
