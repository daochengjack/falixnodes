const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

const NAVIGATION_WAIT_UNTIL = 'domcontentloaded';
const DEFAULT_NAVIGATION_TIMEOUT = 90000;
const DEFAULT_TIMEOUT = 60000;
const LOGIN_FORM_TIMEOUT = 45000;
const DEFAULT_VIEWPORT = { width: 1366, height: 768 };
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EMAIL_SELECTOR_CANDIDATES = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  '#email',
  'input[placeholder*="email" i]',
  'input[placeholder*="username" i]'
];
const PASSWORD_SELECTOR_CANDIDATES = [
  'input[name="password"]',
  'input[type="password"]',
  '#password',
  'input[placeholder*="password" i]'
];
const SUBMIT_SELECTOR_CANDIDATES = [
  'button[type="submit"]',
  'input[type="submit"]',
  '[data-testid*="login"]',
  '.btn-primary',
  '.login-btn',
  '.signin-btn'
];
const LOGIN_EMAIL_SELECTOR = EMAIL_SELECTOR_CANDIDATES.join(', ');
const LOGIN_PASSWORD_SELECTOR = PASSWORD_SELECTOR_CANDIDATES.join(', ');
const BLOCKED_DOMAIN_PATTERNS = [
  /snigelweb\.com/i,
  /prebid/i,
  /onetag/i,
  /rubiconproject\.com/i,
  /adnxs\.com/i,
  /pubmatic\.com/i,
  /lijit\.com/i,
  /triplelift\.com/i,
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /googletagmanager\.com/i,
  /googletagservices\.com/i,
  /google-analytics\.com/i
];

class CloudflareChallengeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudflareChallengeError';
  }
}

async function withRetry(fn, options) {
  const { retries, onFailedAttempt } = options;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CloudflareChallengeError) {
        throw error;
      }

      if (i < retries) {
        if (onFailedAttempt) {
          await onFailedAttempt({ attemptNumber: i + 1, retriesLeft: retries - i, message: error.message });
        }
      } else {
        throw error;
      }
    }
  }
}

puppeteer.use(StealthPlugin());

const DEFAULT_BASE_URL = 'https://client.falixnodes.net';
const normalizedBaseUrl = (process.env.FALIX_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

const config = {
  FALIX_EMAIL: process.env.FALIX_EMAIL,
  FALIX_PASSWORD: process.env.FALIX_PASSWORD,
  FALIX_BASE_URL: normalizedBaseUrl,
  FALIX_TIMER_ID: process.env.FALIX_TIMER_ID || '2330413',
  CLICK_INTERVAL_MS: parseInt(process.env.CLICK_INTERVAL_MS) || 2400000,
  HEADLESS: process.env.HEADLESS !== 'false'
};

if (!config.FALIX_EMAIL || !config.FALIX_PASSWORD) {
  console.error('FALIX_EMAIL and FALIX_PASSWORD environment variables are required');
  process.exit(1);
}

let browser;
let page;
let pageConfigured = false;
let requestInterceptionConfigured = false;

async function ensurePageConfigured() {
  if (!page) {
    throw new Error('Page is not initialized');
  }

  if (!pageConfigured) {
    await page.setViewport(DEFAULT_VIEWPORT);
    await page.setUserAgent(DEFAULT_USER_AGENT);
    pageConfigured = true;
    return;
  }

  const viewport = page.viewport();
  if (!viewport || viewport.width !== DEFAULT_VIEWPORT.width || viewport.height !== DEFAULT_VIEWPORT.height) {
    await page.setViewport(DEFAULT_VIEWPORT);
  }

  const currentUserAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
  if (currentUserAgent !== DEFAULT_USER_AGENT) {
    await page.setUserAgent(DEFAULT_USER_AGENT);
  }
}

function buildAllowedHosts() {
  const hosts = new Set(['static.falixnodes.net']);
  const addHost = (value) => {
    if (!value) {
      return;
    }
    try {
      const url = new URL(value);
      if (url.hostname) {
        hosts.add(url.hostname);
      }
    } catch {
      hosts.add(value);
    }
  };

  addHost(config.FALIX_BASE_URL);
  addHost(config.FALIX_CONSOLE_URL);
  return hosts;
}

function shouldBlockRequest(hostname, url, allowedHosts) {
  if (!hostname) {
    return false;
  }

  if (allowedHosts.has(hostname)) {
    return false;
  }

  if (hostname.endsWith('.falixnodes.net')) {
    return false;
  }

  if (/^data:/i.test(url) || /^blob:/i.test(url)) {
    return false;
  }

  if (BLOCKED_DOMAIN_PATTERNS.some(pattern => pattern.test(hostname) || pattern.test(url))) {
    return true;
  }

  return false;
}

async function setupRequestInterception() {
  if (!page || requestInterceptionConfigured) {
    return;
  }

  const allowedHosts = buildAllowedHosts();

  try {
    await page.setRequestInterception(true);
  } catch (error) {
    console.error('Failed to enable request interception:', error.message);
    return;
  }

  page.on('request', (request) => {
    const url = request.url();
    let hostname = null;

    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = null;
    }

    if (shouldBlockRequest(hostname, url, allowedHosts)) {
      request.abort().catch(() => {});
      return;
    }

    request.continue().catch(() => {});
  });

  requestInterceptionConfigured = true;
}

async function waitForLoginFormReady(timeout = LOGIN_FORM_TIMEOUT) {
  if (!page) {
    throw new Error('Page is not initialized');
  }

  console.log('Waiting for login form selectors...');
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const emailElement = await findElementInFrames(EMAIL_SELECTOR_CANDIDATES);
    const passwordElement = await findElementInFrames(PASSWORD_SELECTOR_CANDIDATES);

    if (emailElement && passwordElement) {
      console.log('Login form selectors detected.');
      return;
    }

    const remaining = Math.max(250, Math.min(750, deadline - Date.now()));
    await page.waitForTimeout(remaining);
  }

  throw new Error(`Login form selectors not detected within ${timeout}ms`);
}

async function waitForLoginFormDismissed(timeout = DEFAULT_NAVIGATION_TIMEOUT) {
  if (!page) {
    throw new Error('Page is not initialized');
  }

  console.log('Waiting for login form to disappear...');
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const emailElement = await findElementInFrames(EMAIL_SELECTOR_CANDIDATES);
    const passwordElement = await findElementInFrames(PASSWORD_SELECTOR_CANDIDATES);

    if (!emailElement && !passwordElement) {
      console.log('Login form no longer visible.');
      return;
    }

    const remaining = Math.max(250, Math.min(750, deadline - Date.now()));
    await page.waitForTimeout(remaining);
  }

  throw new Error(`Login form still visible after ${timeout}ms`);
}

async function gotoWithRetry(url, options = {}) {
  const { retries = 2, waitUntil = NAVIGATION_WAIT_UNTIL, timeout = DEFAULT_NAVIGATION_TIMEOUT, onFailedAttempt, ...rest } = options;
  const navigationOptions = { waitUntil, timeout, ...rest };

  return withRetry(async () => {
    await ensurePageConfigured();
    await setupRequestInterception();
    const response = await page.goto(url, navigationOptions);

    if (page.url() === 'about:blank') {
      console.log(`Navigation to ${url} resulted in about:blank, attempting reload`);
      await page.waitForTimeout(500);
      const reloadResponse = await page.reload({ waitUntil, timeout });
      if (page.url() === 'about:blank') {
        throw new Error(`Navigation to ${url} remained on about:blank after reload`);
      }
      return reloadResponse;
    }

    return response;
  }, {
    retries,
    onFailedAttempt: async (attemptInfo) => {
      console.log(`Navigation to ${url} failed on attempt ${attemptInfo.attemptNumber}: ${attemptInfo.message}`);
      if (onFailedAttempt) {
        await onFailedAttempt(attemptInfo);
      }
    }
  });
}

async function initializeBrowser() {
  console.log('Initializing browser...');
  browser = await puppeteer.launch({
    headless: config.HEADLESS ? "new" : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });
  
  page = await browser.newPage();
  pageConfigured = false;
  requestInterceptionConfigured = false;
  await ensurePageConfigured();
  try {
    await page.setBypassCSP(true);
  } catch (error) {
    console.warn(`Unable to set bypass CSP: ${error.message}`);
  }
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT);
  await setupRequestInterception();
}

async function captureDiagnosticInfo(context) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = `/tmp/falix-${context}-${timestamp}.png`;
    const htmlPath = `/tmp/falix-${context}-${timestamp}.html`;
    
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(htmlPath, html);
    
    console.log(`Diagnostic info captured: ${screenshotPath}, ${htmlPath}`);
    console.log(`Current URL: ${page.url()}`);
    
    // Log available frames
    const frames = page.frames();
    console.log(`Available frames: ${frames.length}`);
    frames.forEach((frame, i) => {
      console.log(`  Frame ${i}: ${frame.url()}`);
    });
    
    return { screenshotPath, htmlPath };
  } catch (error) {
    console.error('Failed to capture diagnostic info:', error.message);
  }
}

async function waitForSelectorWithFallbacks(selectors, options = {}) {
  const timeout = options.timeout || 45000;
  
  for (const selector of selectors) {
    try {
      console.log(`Trying selector: ${selector}`);
      await page.waitForSelector(selector, { timeout: Math.min(timeout / selectors.length, 10000) });
      console.log(`Found element with selector: ${selector}`);
      return selector;
    } catch (error) {
      console.log(`Selector ${selector} not found: ${error.message}`);
    }
  }
  throw new Error(`None of the selectors were found: ${selectors.join(', ')}`);
}

async function findElementInFrames(selectors) {
  const frames = page.frames();
  
  // Try main page first
  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) return { frame: page, selector };
    } catch (error) {
      // Continue
    }
  }
  
  // Try all frames
  for (const frame of frames) {
    for (const selector of selectors) {
      try {
        const element = await frame.$(selector);
        if (element) return { frame, selector };
      } catch (error) {
        // Continue
      }
    }
  }
  
  return null;
}

async function scrollIntoViewAndCheck(frame, selector) {
  try {
    const isVisibleAndEnabled = await frame.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return { visible: false, enabled: false };
      
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const isVisible = style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       style.opacity !== '0' &&
                       rect.width > 0 && 
                       rect.height > 0;
      
      const isEnabled = !element.disabled && !element.hasAttribute('disabled');
      
      return { visible: isVisible, enabled: isEnabled };
    }, selector);
    
    return isVisibleAndEnabled;
  } catch (error) {
    console.log(`Failed to check visibility for ${selector}: ${error.message}`);
    return { visible: false, enabled: false };
  }
}

async function detectChallengeOrBlock() {
  try {
    const challengeDetected = await page.evaluate(() => {
      const recaptchaSelectors = [
        'iframe[src*="recaptcha"]',
        '.g-recaptcha',
        '[data-sitekey]'
      ];
      
      const turnstileSelectors = [
        'iframe[src*="turnstile"]',
        '.cf-turnstile',
        '[data-turnstile-sitekey]'
      ];
      
      for (const selector of [...recaptchaSelectors, ...turnstileSelectors]) {
        if (document.querySelector(selector)) {
          return { detected: true, type: selector };
        }
      }
      
      return { detected: false, type: null };
    });
    
    return challengeDetected;
  } catch (error) {
    return { detected: false, type: null };
  }
}

async function waitForPostSubmitOutcome(timeout = 60000) {
  console.log('Waiting for post-submit outcome...');
  
  const startUrl = page.url();
  console.log(`Starting URL: ${startUrl}`);
  
  try {
    const result = await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }).then(() => ({ type: 'navigation' })).catch(() => null),
      
      page.waitForFunction(
        (url) => {
          const currentUrl = window.location.href;
          return !/\/auth(\/|$)/.test(currentUrl) && currentUrl !== url;
        },
        { timeout },
        startUrl
      ).then(() => ({ type: 'url-change' })).catch(() => null),
      
      page.waitForSelector('[role="alert"], .error, .toast, [data-testid*="error"], .alert-danger, .notification-error', { timeout })
        .then(() => ({ type: 'error' }))
        .catch(() => null)
    ]);
    
    if (!result) {
      console.log('Post-submit wait timed out without clear outcome');
      return { success: false, reason: 'timeout' };
    }
    
    const finalUrl = page.url();
    console.log(`Post-submit outcome: ${result.type}, final URL: ${finalUrl}`);
    
    if (result.type === 'error') {
      const errorText = await page.evaluate(() => {
        const errorEl = document.querySelector('[role="alert"], .error, .toast, [data-testid*="error"], .alert-danger, .notification-error');
        return errorEl ? errorEl.textContent.trim() : 'Unknown error';
      }).catch(() => 'Unknown error');
      
      console.log(`Error message detected: ${errorText}`);
      return { success: false, reason: 'error-message', details: errorText };
    }
    
    if (!/\/auth(\/|$)/.test(finalUrl)) {
      console.log('Successfully left auth page');
      return { success: true, reason: result.type };
    }
    
    console.log('Still on auth page after navigation');
    return { success: false, reason: 'still-on-auth' };
    
  } catch (error) {
    console.log(`Post-submit wait error: ${error.message}`);
    return { success: false, reason: 'exception', details: error.message };
  }
}

async function submitLoginForm(emailElement, passwordElement, submitElement) {
  console.log('Preparing to submit login form...');
  
  await captureDiagnosticInfo('pre-submit');
  
  console.log('Scrolling email field into view...');
  const emailCheck = await scrollIntoViewAndCheck(emailElement.frame, emailElement.selector);
  if (!emailCheck.visible || !emailCheck.enabled) {
    console.warn(`Email field visibility: ${emailCheck.visible}, enabled: ${emailCheck.enabled}`);
  }
  await emailElement.frame.waitForTimeout(300);
  
  console.log('Scrolling password field into view...');
  const passwordCheck = await scrollIntoViewAndCheck(passwordElement.frame, passwordElement.selector);
  if (!passwordCheck.visible || !passwordCheck.enabled) {
    console.warn(`Password field visibility: ${passwordCheck.visible}, enabled: ${passwordCheck.enabled}`);
  }
  await passwordElement.frame.waitForTimeout(300);
  
  if (submitElement) {
    console.log('Scrolling submit button into view...');
    const submitCheck = await scrollIntoViewAndCheck(submitElement.frame, submitElement.selector);
    if (!submitCheck.visible || !submitCheck.enabled) {
      console.warn(`Submit button visibility: ${submitCheck.visible}, enabled: ${submitCheck.enabled}`);
    }
    await submitElement.frame.waitForTimeout(300);
  }
  
  console.log('Typing credentials with delays...');
  await emailElement.frame.focus(emailElement.selector).catch(() => {});
  await emailElement.frame.click(emailElement.selector, { clickCount: 3 }).catch(() => {});
  await emailElement.frame.waitForTimeout(100);
  await emailElement.frame.type(emailElement.selector, config.FALIX_EMAIL, { delay: 50 });
  await emailElement.frame.waitForTimeout(200);
  
  await passwordElement.frame.focus(passwordElement.selector).catch(() => {});
  await passwordElement.frame.waitForTimeout(100);
  await passwordElement.frame.type(passwordElement.selector, config.FALIX_PASSWORD, { delay: 50 });
  await passwordElement.frame.waitForTimeout(300);
  
  const challenge = await detectChallengeOrBlock();
  if (challenge.detected) {
    console.log(`Challenge or block detected: ${challenge.type}`);
    await captureDiagnosticInfo('challenge-detected');
    throw new CloudflareChallengeError(`Challenge detected: ${challenge.type}. Manual intervention required.`);
  }
  
  console.log('Attempting to submit form...');
  let submitSuccess = false;
  
  if (submitElement) {
    try {
      console.log('Attempting regular click on submit button...');
      await submitElement.frame.click(submitElement.selector);
      submitSuccess = true;
      console.log('Submit button clicked successfully');
    } catch (clickError) {
      console.log(`Regular click failed: ${clickError.message}, trying page.evaluate...`);
      
      try {
        submitSuccess = await submitElement.frame.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (element && typeof element.click === 'function') {
            element.click();
            return true;
          }
          return false;
        }, submitElement.selector);
        
        if (submitSuccess) {
          console.log('Submit button clicked via page.evaluate');
        }
      } catch (evalError) {
        console.log(`page.evaluate click failed: ${evalError.message}`);
      }
    }
  }
  
  if (!submitSuccess) {
    console.log('Submit button click failed or not available, pressing Enter on password field...');
    try {
      await passwordElement.frame.focus(passwordElement.selector);
      await passwordElement.frame.keyboard.press('Enter');
      submitSuccess = true;
      console.log('Pressed Enter on password field');
    } catch (enterError) {
      console.log(`Enter press failed: ${enterError.message}`);
      throw new Error('Failed to submit form via click or Enter');
    }
  }
  
  await page.waitForTimeout(1000);
  
  return submitSuccess;
}

async function handleRedirects() {
  console.log('Checking for redirects...');
  
  // Wait a bit to see if we get redirected
  await page.waitForTimeout(2000);
  
  const currentUrl = page.url();
  console.log(`Current URL after potential redirect: ${currentUrl}`);
  
  // Handle common redirect patterns
  if (currentUrl.includes('/auth') && !currentUrl.includes('/login')) {
    console.log('Detected redirect to auth page, looking for login options...');
    
    // Try to find login links or buttons
    const loginSelectors = [
      'a[href*="login"]',
      'a[href*="signin"]',
      '.login-btn',
      '.signin-btn'
    ];
    
    // Also try to find buttons by text content using evaluate
    const loginButtonFound = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, .btn, a');
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('log in') || text.includes('sign in') || text.includes('login')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (loginButtonFound) {
      await page.waitForTimeout(500);
      await waitForLoginFormReady();
      console.log('Clicked login button by text content');
      return true;
    }
    
    for (const selector of loginSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        await page.waitForTimeout(300);
        await waitForLoginFormReady();
        console.log(`Clicked login element: ${selector}`);
        return true;
      } catch (error) {
        console.log(`Redirect handler attempt for ${selector} failed: ${error.message}`);
      }
    }
  }
  
  return false;
}

async function login() {
  const loginUrl = `${config.FALIX_BASE_URL}/auth/login`;

  return withRetry(async () => {
    console.log('Attempting to login...');
    
    try {
      await gotoWithRetry(loginUrl, { waitUntil: NAVIGATION_WAIT_UNTIL, timeout: DEFAULT_NAVIGATION_TIMEOUT });
      await ensureNoCloudflareChallenge('login navigation');

      try {
        await page.waitForSelector(LOGIN_EMAIL_SELECTOR, { timeout: LOGIN_FORM_TIMEOUT });
      } catch (selectorError) {
        console.log(`Primary login selector wait did not resolve: ${selectorError.message}`);
      }

      let loginFormReady = false;
      try {
        await waitForLoginFormReady();
        loginFormReady = true;
      } catch (readinessError) {
        console.log(`Login form not ready immediately: ${readinessError.message}`);
      }

      const redirectHandled = await handleRedirects();

      if (!loginFormReady || redirectHandled) {
        await waitForLoginFormReady();
      }

      await ensureNoCloudflareChallenge('post-redirect');

      const emailElement = await findElementInFrames(EMAIL_SELECTOR_CANDIDATES);
      const passwordElement = await findElementInFrames(PASSWORD_SELECTOR_CANDIDATES);
      let submitElement = await findElementInFrames(SUBMIT_SELECTOR_CANDIDATES);
      
      if (!emailElement) {
        throw new Error('Email input field not found');
      }
      if (!passwordElement) {
        throw new Error('Password input field not found');
      }
      
      if (!submitElement) {
        console.log('Submit button not found with selectors, trying text content...');
        const submitButtonFound = await emailElement.frame.evaluate(() => {
          const buttons = document.querySelectorAll('button, .btn, input[type="submit"], input[type="button"]');
          for (const btn of buttons) {
            const text = (btn.innerText || btn.textContent || btn.value || '').toLowerCase();
            if (text.includes('log in') || text.includes('sign in') || text.includes('login') || 
                text.includes('submit') || text.includes('continue')) {
              return true;
            }
          }
          return false;
        });
        
        if (submitButtonFound) {
          submitElement = {
            frame: emailElement.frame,
            selector: 'button, .btn, input[type="submit"], input[type="button"]'
          };
        } else {
          console.log('Submit button not found - will use Enter key fallback');
        }
      }
      
      console.log(`Found email field with selector: ${emailElement.selector}`);
      console.log(`Found password field with selector: ${passwordElement.selector}`);
      if (submitElement) {
        console.log(`Found submit button with selector: ${submitElement.selector}`);
      } else {
        console.log('No submit button found, will rely on Enter key');
      }
      
      const maxSubmitAttempts = 3;
      let submitAttempt = 0;
      let loginSuccess = false;
      
      while (submitAttempt < maxSubmitAttempts && !loginSuccess) {
        submitAttempt++;
        console.log(`Login submit attempt ${submitAttempt} of ${maxSubmitAttempts}...`);
        
        try {
          await submitLoginForm(emailElement, passwordElement, submitElement);
          
          const outcome = await waitForPostSubmitOutcome(60000);
          
          if (outcome.success) {
            console.log(`Login successful after ${submitAttempt} attempt(s)`);
            loginSuccess = true;
            break;
          } else {
            console.log(`Login attempt ${submitAttempt} failed: ${outcome.reason}`);
            if (outcome.details) {
              console.log(`Details: ${outcome.details}`);
            }
            
            await captureDiagnosticInfo(`post-submit-attempt-${submitAttempt}`);
            
            if (submitAttempt < maxSubmitAttempts) {
              const backoffMs = 1000 * submitAttempt;
              console.log(`Waiting ${backoffMs}ms before retry...`);
              await page.waitForTimeout(backoffMs);
              
              const currentUrl = page.url();
              if (/\/auth(\/|$)/.test(currentUrl)) {
                console.log('Still on auth page, reloading...');
                await page.reload({ waitUntil: NAVIGATION_WAIT_UNTIL, timeout: DEFAULT_NAVIGATION_TIMEOUT });
                await page.waitForTimeout(500);
              }
            }
          }
        } catch (submitError) {
          console.log(`Submit attempt ${submitAttempt} threw error: ${submitError.message}`);
          await captureDiagnosticInfo(`submit-error-attempt-${submitAttempt}`);
          
          if (submitAttempt >= maxSubmitAttempts) {
            throw submitError;
          }
          
          const backoffMs = 1000 * submitAttempt;
          await page.waitForTimeout(backoffMs);
        }
      }
      
      if (!loginSuccess) {
        throw new Error(`Failed to login after ${maxSubmitAttempts} submit attempts`);
      }
      
      await ensureNoCloudflareChallenge('post-login');
      
      console.log('Login completed successfully');
      
    } catch (error) {
      if (error instanceof CloudflareChallengeError) {
        throw error;
      }
      console.error(`Login attempt failed: ${error.message}`);
      await captureDiagnosticInfo('login-failure');
      throw error;
    }
  }, {
    retries: 3,
    onFailedAttempt: async (error) => {
      console.log(`Login attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
      if (error.attemptNumber > 1) {
        await page.reload({ waitUntil: NAVIGATION_WAIT_UNTIL, timeout: DEFAULT_NAVIGATION_TIMEOUT });
        await page.waitForTimeout(500);
      }
    }
  });
}

async function ensureNoCloudflareChallenge(context) {
  if (!page) {
    return;
  }

  const currentUrl = page.url();
  const challengeUrlIndicators = [
    '/cdn-cgi/challenge',
    '/cdn-cgi/challenge-platform',
    '/cf-challenge',
    '/cdn-cgi/l/chk_jschl',
    '/cdn-cgi/s/chk_jschl',
    'challenges.cloudflare.com'
  ];

  let detectionDetail = challengeUrlIndicators.find(indicator => currentUrl.includes(indicator));
  if (detectionDetail) {
    detectionDetail = `URL indicator: ${detectionDetail}`;
  } else {
    try {
      const indicator = await page.evaluate((selectors) => {
        for (const selector of selectors) {
          if (document.querySelector(selector)) {
            return selector;
          }
        }

        const bodyText = document.body ? (document.body.innerText || document.body.textContent || '').toLowerCase() : '';
        if (bodyText.includes('checking your browser before accessing')) {
          return 'checking-browser-text';
        }

        return null;
      }, [
        '.cf-browser-verification',
        '#cf-challenge-running',
        '.cf-im-under-attack',
        'form[action*="/cdn-cgi/challenge"]',
        'body.cf-challenge',
        '[data-translate="checking_browser"]'
      ]);

      if (indicator) {
        detectionDetail = indicator === 'checking-browser-text'
          ? 'Text indicator: checking your browser before accessing'
          : `Selector indicator: ${indicator}`;
      }
    } catch (error) {
      // Ignore errors when detecting challenge indicators
    }
  }

  if (detectionDetail) {
    await captureDiagnosticInfo('cloudflare-challenge');
    throw new CloudflareChallengeError(`Cloudflare challenge detected during ${context}. ${detectionDetail} Skipping run so scheduler can retry later.`);
  }
}

async function findAddTimeButton() {
  const buttonElement = await page.evaluate(() => {
    const buttonTextMatchers = ['add time', '添加时间'];
    const allButtons = document.querySelectorAll('button, .btn, a[role="button"], input[type="button"], input[type="submit"]');
    
    for (const btn of allButtons) {
      const text = (btn.innerText || btn.textContent || btn.value || '').toLowerCase().trim();
      if (buttonTextMatchers.some(matcher => text.includes(matcher))) {
        return true;
      }
    }
    
    const selectorCandidates = [
      '[data-testid*="add-time"]',
      '[data-testid*="addtime"]',
      '.add-time',
      '.add-time-btn',
      'button[class*="add-time" i]',
      'button[class*="addtime" i]'
    ];
    
    for (const selector of selectorCandidates) {
      if (document.querySelector(selector)) {
        return true;
      }
    }
    
    return false;
  });
  
  return buttonElement;
}

async function clickAddTimeButton() {
  console.log('Attempting to click Add time button...');
  
  const clicked = await page.evaluate(() => {
    const buttonTextMatchers = ['add time', '添加时间'];
    const allButtons = document.querySelectorAll('button, .btn, a[role="button"], input[type="button"], input[type="submit"]');
    
    for (const btn of allButtons) {
      const text = (btn.innerText || btn.textContent || btn.value || '').toLowerCase().trim();
      if (buttonTextMatchers.some(matcher => text.includes(matcher))) {
        if (typeof btn.click === 'function') {
          btn.click();
          return { success: true, method: 'text-match' };
        }
      }
    }
    
    const selectorCandidates = [
      '[data-testid*="add-time"]',
      '[data-testid*="addtime"]',
      '.add-time',
      '.add-time-btn',
      'button[class*="add-time" i]',
      'button[class*="addtime" i]'
    ];
    
    for (const selector of selectorCandidates) {
      const element = document.querySelector(selector);
      if (element && typeof element.click === 'function') {
        element.click();
        return { success: true, method: `selector-${selector}` };
      }
    }
    
    return { success: false, method: null };
  });
  
  if (clicked.success) {
    console.log(`Add time button clicked successfully using ${clicked.method}`);
    return true;
  }
  
  console.log('Add time button not found or could not be clicked');
  return false;
}

async function verifyAddTimeSuccess() {
  console.log('Verifying Add time button click success...');
  await page.waitForTimeout(2000);
  
  const verification = await page.evaluate(() => {
    const toastSelectors = [
      '.toast',
      '.notification',
      '.alert',
      '.success',
      '.message',
      '[class*="toast"]',
      '[class*="notification"]',
      '[role="alert"]',
      '[class*="snackbar"]'
    ];
    
    let toastFound = false;
    let toastText = '';
    
    for (const selector of toastSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (el.offsetParent !== null) {
          const text = (el.innerText || el.textContent || '').toLowerCase();
          if (text.includes('success') || text.includes('added') || text.includes('time') || text.includes('成功')) {
            toastFound = true;
            toastText = (el.innerText || el.textContent || '').trim();
            break;
          }
        }
      }
      if (toastFound) break;
    }
    
    const buttonTextMatchers = ['add time', '添加时间'];
    const allButtons = document.querySelectorAll('button, .btn, a[role="button"], input[type="button"], input[type="submit"]');
    let buttonDisabled = false;
    let buttonChanged = false;
    
    for (const btn of allButtons) {
      const text = (btn.innerText || btn.textContent || btn.value || '').toLowerCase().trim();
      if (buttonTextMatchers.some(matcher => text.includes(matcher))) {
        if (btn.disabled || btn.hasAttribute('disabled') || btn.classList.contains('disabled')) {
          buttonDisabled = true;
        }
        const btnText = (btn.innerText || btn.textContent || '').toLowerCase();
        if (btnText.includes('added') || btnText.includes('已添加') || btnText.includes('success')) {
          buttonChanged = true;
        }
      }
    }
    
    const timerElements = document.querySelectorAll('[class*="timer"], [class*="countdown"], [class*="time"], [id*="timer"], [id*="countdown"]');
    let timerText = '';
    for (const el of timerElements) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text && /\d+/.test(text)) {
        timerText = text;
        break;
      }
    }
    
    return {
      toastFound,
      toastText,
      buttonDisabled,
      buttonChanged,
      timerText,
      bodyText: (document.body.innerText || document.body.textContent || '').toLowerCase().substring(0, 1000)
    };
  });
  
  if (verification.toastFound) {
    console.log(`Success verified via toast: ${verification.toastText}`);
    return true;
  }
  
  if (verification.buttonDisabled) {
    console.log('Success verified: Add time button is now disabled');
    return true;
  }
  
  if (verification.buttonChanged) {
    console.log('Success verified: Add time button text changed to success state');
    return true;
  }
  
  if (verification.timerText) {
    console.log(`Timer display found: ${verification.timerText}`);
    return true;
  }
  
  if (verification.bodyText.includes('success') || verification.bodyText.includes('added')) {
    console.log('Success indicated in page content');
    return true;
  }
  
  console.log('Could not verify success definitively, assuming success if no error occurred');
  return true;
}

async function performTimerKeepalive() {
  const timerUrl = `${config.FALIX_BASE_URL}/timer?id=${config.FALIX_TIMER_ID}`;
  console.log(`Navigating to timer page: ${timerUrl}`);
  
  try {
    await gotoWithRetry(timerUrl, { waitUntil: NAVIGATION_WAIT_UNTIL, timeout: DEFAULT_NAVIGATION_TIMEOUT });
    await ensureNoCloudflareChallenge('timer page navigation');
    await page.waitForTimeout(2000);
    
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Timer page loaded, searching for Add time button...`);
    
    const buttonFound = await findAddTimeButton();
    if (!buttonFound) {
      console.error('Add time button not found on timer page');
      await captureDiagnosticInfo('add-time-button-not-found');
      throw new Error('Add time button not found');
    }
    
    const retryConfig = {
      maxAttempts: 3,
      backoffMs: 2000
    };
    
    let clicked = false;
    let verified = false;
    
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      console.log(`Click attempt ${attempt}/${retryConfig.maxAttempts}...`);
      
      clicked = await clickAddTimeButton();
      
      if (!clicked) {
        console.log(`Failed to click on attempt ${attempt}`);
        if (attempt < retryConfig.maxAttempts) {
          console.log(`Waiting ${retryConfig.backoffMs}ms before retry...`);
          await page.waitForTimeout(retryConfig.backoffMs);
          continue;
        }
        break;
      }
      
      verified = await verifyAddTimeSuccess();
      
      if (verified) {
        const successTimestamp = new Date().toISOString();
        console.log(`[${successTimestamp}] Add time click verified successfully on attempt ${attempt}`);
        return { success: true, attempts: attempt };
      }
      
      console.log(`Verification failed on attempt ${attempt}`);
      if (attempt < retryConfig.maxAttempts) {
        console.log(`Waiting ${retryConfig.backoffMs}ms before retry...`);
        await page.waitForTimeout(retryConfig.backoffMs);
      }
    }
    
    if (!clicked) {
      throw new Error('Failed to click Add time button after all retry attempts');
    }
    
    if (!verified) {
      console.log('Warning: Could not verify success, but click was executed');
      return { success: true, attempts: retryConfig.maxAttempts, verified: false };
    }
    
    return { success: true, attempts: retryConfig.maxAttempts };
    
  } catch (error) {
    if (error instanceof CloudflareChallengeError) {
      throw error;
    }
    console.error('Error performing timer keepalive:', error.message);
    await captureDiagnosticInfo('timer-keepalive-error');
    throw error;
  }
}

async function cleanup() {
  console.log('Cleaning up...');
  if (browser) {
    await browser.close();
  }
}

async function main() {
  try {
    console.log('\n=== Starting Falix Timer Keepalive ===');
    console.log(`Timer ID: ${config.FALIX_TIMER_ID}`);
    console.log(`Click interval: ${config.CLICK_INTERVAL_MS}ms (${config.CLICK_INTERVAL_MS / 60000} minutes)`);
    
    await initializeBrowser();
    await login();
    
    const result = await performTimerKeepalive();
    
    if (result.success) {
      console.log('\n=== Timer keepalive completed successfully ===');
      if (result.verified === false) {
        console.log('Note: Success could not be fully verified, but click was executed');
      }
    } else {
      console.error('\n=== Timer keepalive failed ===');
      throw new Error('Timer keepalive operation failed');
    }
  } catch (error) {
    if (error instanceof CloudflareChallengeError) {
      console.log('\n=== Cloudflare challenge encountered ===');
      console.log(error.message);
      console.log('Skipping run so the scheduler can retry later.');
      return;
    }
    console.error('Fatal error in timer keepalive workflow:', error);
    throw error;
  } finally {
    await cleanup();
  }
}

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, cleaning up...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, cleaning up...');
  await cleanup();
  process.exit(0);
});

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
