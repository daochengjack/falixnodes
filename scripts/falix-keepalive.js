const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

const NAVIGATION_WAIT_UNTIL = ['domcontentloaded', 'networkidle0'];
const DEFAULT_NAVIGATION_TIMEOUT = 45000;
const DEFAULT_VIEWPORT = { width: 1366, height: 768 };
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function withRetry(fn, options) {
  const { retries, onFailedAttempt } = options;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
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
const normalizedConsoleUrl = (process.env.FALIX_CONSOLE_URL || `${normalizedBaseUrl}/server/console`).trim();

const config = {
  FALIX_EMAIL: process.env.FALIX_EMAIL,
  FALIX_PASSWORD: process.env.FALIX_PASSWORD,
  FALIX_BASE_URL: normalizedBaseUrl,
  FALIX_SERVER_HOST: (process.env.FALIX_SERVER_HOST || 'mikeqd.falixsrv.me').trim(),
  FALIX_SERVER_NAME: (process.env.FALIX_SERVER_NAME || 'mikeqd.falixsrv.me').trim(),
  FALIX_CONSOLE_URL: normalizedConsoleUrl,
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 120000,
  AD_WATCH_MS: parseInt(process.env.AD_WATCH_MS) || 35000,
  HEADLESS: process.env.HEADLESS !== 'false'
};

if (!config.FALIX_EMAIL || !config.FALIX_PASSWORD) {
  console.error('FALIX_EMAIL and FALIX_PASSWORD environment variables are required');
  process.exit(1);
}

let browser;
let page;
let pageConfigured = false;

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

async function gotoWithRetry(url, options = {}) {
  const { retries = 2, waitUntil = NAVIGATION_WAIT_UNTIL, timeout = DEFAULT_NAVIGATION_TIMEOUT, onFailedAttempt, ...rest } = options;
  const navigationOptions = { waitUntil, timeout, ...rest };

  return withRetry(async () => {
    await ensurePageConfigured();
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
  await ensurePageConfigured();
  page.setDefaultTimeout(DEFAULT_NAVIGATION_TIMEOUT);
  page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT);
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
      await page.waitForNavigation({ waitUntil: NAVIGATION_WAIT_UNTIL, timeout: DEFAULT_NAVIGATION_TIMEOUT });
      console.log('Clicked login button by text content');
      return true;
    }
    
    for (const selector of loginSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await Promise.all([
          page.waitForNavigation({ waitUntil: NAVIGATION_WAIT_UNTIL, timeout: DEFAULT_NAVIGATION_TIMEOUT }),
          page.click(selector)
        ]);
        console.log(`Clicked login element: ${selector}`);
        return true;
      } catch (error) {
        // Continue trying other selectors
      }
    }
  }
  
  return false;
}

async function login() {
  return withRetry(async () => {
    console.log('Attempting to login...');
    
    try {
      // Navigate to login page with better wait conditions
      await gotoWithRetry(`${config.FALIX_BASE_URL}/auth/login`);
      
      // Handle potential redirects
      await handleRedirects();
      
      // Handle Cloudflare/Turnstile/hCaptcha before looking for login form
      await handleEnhancedCloudflareVerification();
      
      // Robust selector arrays
      const emailSelectors = [
        'input[name="email"]',
        'input[type="email"]',
        '#email',
        'input[name="username"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]'
      ];
      
      const passwordSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        '#password',
        'input[placeholder*="password" i]'
      ];
      
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        '[data-testid*="login"]',
        '.btn-primary',
        '.login-btn',
        '.signin-btn'
      ];
      
      // Find elements in main page or frames
      const emailElement = await findElementInFrames(emailSelectors);
      const passwordElement = await findElementInFrames(passwordSelectors);
      let submitElement = await findElementInFrames(submitSelectors);
      
      if (!emailElement) {
        throw new Error('Email input field not found');
      }
      if (!passwordElement) {
        throw new Error('Password input field not found');
      }
      
      // Fallback: try to find submit button by text content
      if (!submitElement) {
        console.log('Submit button not found with selectors, trying text content...');
        const submitButtonFound = await emailElement.frame.evaluate(() => {
          const buttons = document.querySelectorAll('button, .btn, input[type="submit"], input[type="button"]');
          for (const btn of buttons) {
            const text = btn.textContent.toLowerCase();
            if (text.includes('log in') || text.includes('sign in') || text.includes('login') || 
                text.includes('submit') || text.includes('continue')) {
              return true;
            }
          }
          return false;
        });
        
        if (submitButtonFound) {
          // Use a generic selector to click the button we found
          submitElement = { 
            frame: emailElement.frame, 
            selector: 'button, .btn, input[type="submit"], input[type="button"]' 
          };
        }
      }
      
      if (!submitElement) {
        throw new Error('Submit button not found');
      }
      
      console.log(`Found email field with selector: ${emailElement.selector}`);
      console.log(`Found password field with selector: ${passwordElement.selector}`);
      console.log(`Found submit button with selector: ${submitElement.selector}`);
      
      // Fill in the form
      await emailElement.frame.type(emailElement.selector, config.FALIX_EMAIL);
      await passwordElement.frame.type(passwordElement.selector, config.FALIX_PASSWORD);
      
      // Submit the form
      await Promise.all([
        emailElement.frame.waitForNavigation({ waitUntil: NAVIGATION_WAIT_UNTIL, timeout: DEFAULT_NAVIGATION_TIMEOUT }),
        emailElement.frame.click(submitElement.selector)
      ]);
      
      // Handle any post-login verification
      await handleEnhancedCloudflareVerification();
      
      console.log('Login successful');
      
    } catch (error) {
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
      }
    }
  });
}

async function handleEnhancedCloudflareVerification() {
  console.log('Checking for Cloudflare/Turnstile/hCaptcha verification...');
  
  const maxWaitTime = 90000; // 90 seconds
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Check for various verification indicators
      const verificationSelectors = [
        // Cloudflare
        '.cf-browser-verification',
        '#cf-challenge-running',
        '[data-ray]',
        '.cf-im-under-attack',
        // Turnstile
        'iframe[title*="turnstile" i]',
        'iframe[src*="turnstile"]',
        '.cf-turnstile',
        // hCaptcha
        'iframe[title*="hcaptcha" i]',
        'iframe[src*="hcaptcha"]',
        '.h-captcha',
        // Generic challenge indicators
        '.challenge-form',
        '[id*="challenge"]',
        '[class*="challenge"]'
      ];
      
      let verificationDetected = false;
      
      for (const selector of verificationSelectors) {
        const element = await page.$(selector);
        if (element) {
          console.log(`Verification detected with selector: ${selector}`);
          verificationDetected = true;
          break;
        }
      }
      
      // Check iframes for verification challenges
      const frames = page.frames();
      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('turnstile') || frameUrl.includes('hcaptcha') || 
            frameUrl.includes('challenge') || frameUrl.includes('cf-')) {
          console.log(`Verification detected in iframe: ${frameUrl}`);
          verificationDetected = true;
          break;
        }
      }
      
      if (!verificationDetected) {
        console.log('No verification detected, proceeding...');
        return;
      }
      
      // Try to interact with verification elements
      const interacted = await page.evaluate(() => {
        // Try to find and click verify buttons or checkboxes
        const interactSelectors = [
          'input[type="checkbox"]',
          '.cf-turnstile-wrapper',
          '[data-sitekey]'
        ];
        
        for (const selector of interactSelectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            element.click();
            return true;
          }
        }
        
        // Also try to find buttons by text content
        const buttons = document.querySelectorAll('button, .btn, input[type="button"]');
        for (const btn of buttons) {
          const text = btn.textContent.toLowerCase();
          if ((text.includes('verify') || text.includes('i\'m human') || text.includes('continue')) && 
              btn.offsetParent !== null) {
            btn.click();
            return true;
          }
        }
        
        return false;
      });
      
      if (interacted) {
        console.log('Attempted to interact with verification element');
      }
      
      // Wait a bit before checking again
      await page.waitForTimeout(3000);
      
    } catch (error) {
      console.log(`Error during verification check: ${error.message}`);
      await page.waitForTimeout(2000);
    }
  }
  
  console.log('Verification wait timeout reached, proceeding anyway...');
}

async function handleCloudflareVerification() {
  // Keep the original function for backward compatibility
  return handleEnhancedCloudflareVerification();
}

function normalizeWhitespace(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeWhitespace(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function extractHostCandidates(...sources) {
  const hostRegex = /([a-z0-9-]+\.)+[a-z]{2,}/gi;
  const hosts = new Set();

  for (const source of sources) {
    if (!source) continue;
    const text = Array.isArray(source) ? source.join(' ') : String(source);
    let match;
    while ((match = hostRegex.exec(text)) !== null) {
      const host = match[0].toLowerCase();
      if (!host.includes(' ')) {
        hosts.add(host);
      }
    }
  }

  return Array.from(hosts);
}

function determineStatusFromIndicators({ statusCandidates = [], buttonTexts = [], explicitStartButtons = 0, explicitStopButtons = 0 }) {
  const combined = uniqueStrings([...statusCandidates, ...buttonTexts]);
  const lowerCombined = combined.map(text => text.toLowerCase());

  const hasStartControl = explicitStartButtons > 0 || lowerCombined.some(text => text.includes('start') || text.includes('power on') || text.includes('boot'));
  const hasStopControl = explicitStopButtons > 0 || lowerCombined.some(text => text.includes('stop') || text.includes('power off') || text.includes('shutdown'));

  const offlineKeywords = ['offline', 'stopped', 'stopping', 'down', 'idle', 'not running', 'power off', 'start server'];
  const onlineKeywords = ['online', 'running', 'active', 'started', 'up', 'powered on', 'stop server'];

  const offlineText = combined.find(text => offlineKeywords.some(keyword => text.toLowerCase().includes(keyword)));
  const onlineText = combined.find(text => onlineKeywords.some(keyword => text.toLowerCase().includes(keyword)));

  let isOffline = null;
  let statusText = null;

  if (offlineText && !onlineText) {
    isOffline = true;
    statusText = offlineText;
  } else if (onlineText && !offlineText) {
    isOffline = false;
    statusText = onlineText;
  }

  if (isOffline === null) {
    if (hasStopControl && !hasStartControl) {
      isOffline = false;
      statusText = statusText || 'Stop control visible';
    } else if (hasStartControl && !hasStopControl) {
      isOffline = true;
      statusText = statusText || 'Start control visible';
    } else if (hasStartControl && hasStopControl) {
      if (onlineText) {
        isOffline = false;
        statusText = onlineText;
      } else if (offlineText) {
        isOffline = true;
        statusText = offlineText;
      }
    }
  }

  if (isOffline === null) {
    if (onlineText) {
      isOffline = false;
      statusText = onlineText;
    } else if (offlineText) {
      isOffline = true;
      statusText = offlineText;
    }
  }

  if (isOffline === null) {
    isOffline = false;
    statusText = statusText || 'Status unknown - assuming online';
  }

  return {
    isOffline,
    statusText,
    hasStartControl,
    hasStopControl,
    combinedTexts: combined
  };
}

function logServerEntries(entries) {
  console.log('\n=== Detected servers on dashboard ===');
  if (!entries.length) {
    console.log('No servers found on dashboard');
  } else {
    entries.forEach((entry, index) => {
      const host = entry.hostCandidates[0] || 'N/A';
      const name = entry.nameCandidates[0] || 'N/A';
      const statusInfo = determineStatusFromIndicators({
        statusCandidates: entry.statusCandidates,
        buttonTexts: entry.buttonTexts
      });
      console.log(`${index + 1}. Host: ${host} | Name: ${name} | Status: ${statusInfo.statusText}`);
    });
  }
  console.log('=====================================\n');
}

async function attemptConsoleDetection() {
  if (!config.FALIX_CONSOLE_URL) {
    return { success: false, reason: 'Console URL not configured' };
  }

  console.log(`Attempting direct console navigation to ${config.FALIX_CONSOLE_URL}...`);

  try {
    await gotoWithRetry(config.FALIX_CONSOLE_URL);
    await handleEnhancedCloudflareVerification();
    await page.waitForTimeout(2000);

    const consoleData = await page.evaluate(() => {
      const getText = (element) => {
        if (!element) return '';
        const content = element.innerText || element.textContent || '';
        return content.trim();
      };

      const collect = (selectors) => {
        const values = [];
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(node => {
            const value = getText(node);
            if (value) {
              values.push(value);
            }
          });
        });
        return values;
      };

      const headerSelectors = ['.server-header', '.server-title', '.server-name', '.server-heading', '[data-testid*="server-name"]', 'h1', 'h2', 'h3'];
      const hostSelectors = ['.server-host', '.server-address', '.hostname', '[data-testid*="host"]', '[data-testid*="address"]'];
      const statusSelectors = ['.status', '.badge', '.state', '.label', '[class*="status"]', '[data-testid*="status"]', '[class*="state"]'];

      const buttonNodes = document.querySelectorAll('button, .btn, input[type="button"], input[type="submit"], a[role="button"]');
      const buttonTexts = [];
      let startButtons = 0;
      let stopButtons = 0;

      buttonNodes.forEach(btn => {
        const text = getText(btn).toLowerCase();
        if (!text) return;
        buttonTexts.push(text);
        if (text.includes('start') || text.includes('power on') || text.includes('boot')) {
          startButtons += 1;
        }
        if (text.includes('stop') || text.includes('power off') || text.includes('shutdown')) {
          stopButtons += 1;
        }
      });

      const contentRoot = document.querySelector('main') || document.querySelector('#app') || document.body;
      const rawLines = (getText(contentRoot) || '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .slice(0, 100);

      return {
        headerSegments: collect(headerSelectors),
        hostSegments: collect(hostSelectors),
        statusSegments: collect(statusSelectors),
        buttonTexts,
        startButtons,
        stopButtons,
        rawLines
      };
    });

    const headerCandidates = uniqueStrings(consoleData.headerSegments.concat(consoleData.rawLines.slice(0, 10)));
    const hostCandidates = uniqueStrings(consoleData.hostSegments.concat(extractHostCandidates(consoleData.rawLines, consoleData.headerSegments)));
    const statusIndicators = uniqueStrings(consoleData.statusSegments.concat(consoleData.rawLines.filter(line => /online|offline|running|stopped|down|idle/i.test(line.toLowerCase()))));

    const statusInfo = determineStatusFromIndicators({
      statusCandidates: statusIndicators,
      buttonTexts: consoleData.buttonTexts,
      explicitStartButtons: consoleData.startButtons,
      explicitStopButtons: consoleData.stopButtons
    });

    const normalizedTargetHost = config.FALIX_SERVER_HOST.toLowerCase();
    const normalizedTargetName = config.FALIX_SERVER_NAME.toLowerCase();

    const matchedByHost = normalizedTargetHost && hostCandidates.some(host => host.toLowerCase() === normalizedTargetHost);
    const matchedByName = normalizedTargetName && headerCandidates.some(name => name.toLowerCase() === normalizedTargetName);

    console.log(`Console host candidates: ${hostCandidates.join(', ') || 'none'}`);
    console.log(`Console name candidates: ${headerCandidates.join(', ') || 'none'}`);
    console.log(`Console status indicators: ${statusInfo.combinedTexts.join(', ') || 'none'}`);

    if (!matchedByHost && !matchedByName) {
      console.log('Console validation: unable to match configured server by host or name');
      await captureDiagnosticInfo('console-validation-mismatch');
      return { success: false, reason: 'Console page did not match configured server' };
    }

    const matchedBy = matchedByHost ? 'host' : 'name';
    console.log(`Console detection matched by ${matchedBy}. Status: ${statusInfo.statusText}`);

    return {
      success: true,
      matchedBy,
      isOffline: statusInfo.isOffline,
      statusText: statusInfo.statusText
    };
  } catch (error) {
    console.error(`Console detection failed: ${error.message}`);
    await captureDiagnosticInfo('console-direct-link-error');
    return { success: false, reason: error.message };
  }
}

async function loadAllServersOnDashboard() {
  let previousHeight = 0;
  for (let i = 0; i < 8; i++) {
    const currentHeight = await page.evaluate(() => document.body ? document.body.scrollHeight : 0);
    if (currentHeight <= previousHeight) {
      break;
    }
    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    try {
      await page.waitForNetworkIdle({ idleTime: 750, timeout: 5000 });
    } catch (error) {
      // Ignore network idle timeouts
    }
    await page.waitForTimeout(1000);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

async function collectServersFromDashboard() {
  const rawEntries = await page.evaluate(() => {
    const unique = (values = []) => {
      const seen = new Set();
      const result = [];
      for (const value of values) {
        if (!value) continue;
        const normalized = value.replace(/\s+/g, ' ').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
      }
      return result;
    };

    const candidateSelectors = [
      '.server-card',
      '.server-item',
      '.server-row',
      '.server-box',
      '.servers-list .card',
      '.servers-list li',
      'tr',
      '.card',
      'div[class*="server"]',
      'li[class*="server"]',
      '.list-item'
    ];

    const nodes = new Set();
    candidateSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => nodes.add(node));
    });

    const entries = [];

    Array.from(nodes).forEach(node => {
      const textContent = node.innerText || node.textContent || '';
      if (!textContent) return;

      const trimmed = textContent.trim();
      if (!trimmed) return;

      const hostMatches = trimmed.match(/([a-z0-9-]+\.)+[a-z]{2,}/gi) || [];
      const lower = trimmed.toLowerCase();
      const hasKeyword = lower.includes('server') || lower.includes('online') || lower.includes('offline') || lower.includes('start') || lower.includes('stop');

      if (!hostMatches.length && !hasKeyword) {
        return;
      }

      const collect = (selectors) => {
        const values = [];
        selectors.forEach(selector => {
          node.querySelectorAll(selector).forEach(el => {
            const value = (el.innerText || el.textContent || '').trim();
            if (value) {
              values.push(value);
            }
          });
        });
        return values;
      };

      const nameSelectors = ['.server-name', '.name', '.title', '.card-title', 'h1', 'h2', 'h3', 'strong', '[data-testid*="server-name"]'];
      const hostSelectors = ['.server-host', '.hostname', '.address', '[data-testid*="host"]', '[data-testid*="address"]'];
      const statusSelectors = ['.status', '.badge', '.state', '.label', '[class*="status"]', '[class*="state"]'];
      const buttonSelectors = ['button', '.btn', 'a[role="button"]'];

      const rawLines = trimmed.split('\n').map(line => line.trim()).filter(line => line.length > 0).slice(0, 10);

      entries.push({
        nameCandidates: unique([...collect(nameSelectors), ...rawLines.slice(0, 2)]),
        hostCandidates: unique([...collect(hostSelectors), ...hostMatches]),
        statusCandidates: unique([...collect(statusSelectors), ...rawLines.filter(line => /online|offline|running|stopped|down|idle/i.test(line.toLowerCase()))]),
        buttonTexts: unique(collect(buttonSelectors)),
        rawLines,
        rawText: trimmed.slice(0, 500)
      });
    });

    return entries;
  });

  return rawEntries.map(entry => {
    const hostAugments = extractHostCandidates(entry.hostCandidates, entry.rawLines, entry.rawText);
    const lineStatus = entry.rawLines.filter(line => /online|offline|running|stopped|down|idle/i.test(line.toLowerCase()));

    return {
      nameCandidates: uniqueStrings([...entry.nameCandidates, ...entry.rawLines.slice(0, 3)]),
      host_candidates: uniqueStrings([...entry.hostCandidates, ...hostAugments]),
      statusCandidates: uniqueStrings([...entry.statusCandidates, ...lineStatus]),
      buttonTexts: uniqueStrings(entry.buttonTexts),
      rawLines: uniqueStrings(entry.rawLines),
      rawText: entry.rawText
    };
  }).map(entry => ({
    ...entry,
    hostCandidates: entry.host_candidates,
    host_candidates: undefined
  }));
}

function findServerMatch(entries) {
  const targetHost = config.FALIX_SERVER_HOST.toLowerCase();
  const targetName = config.FALIX_SERVER_NAME.toLowerCase();

  for (const entry of entries) {
    const hostMatches = targetHost && entry.hostCandidates.some(host => host.toLowerCase() === targetHost);
    const nameMatches = targetName && entry.nameCandidates.some(name => name.toLowerCase() === targetName);

    if (hostMatches || nameMatches) {
      return {
        entry,
        matchedBy: hostMatches ? 'host' : 'name'
      };
    }
  }

  return null;
}

async function detectServerViaDashboard() {
  console.log('Falling back to dashboard server detection...');

  await gotoWithRetry(`${config.FALIX_BASE_URL}/`);
  await handleEnhancedCloudflareVerification();
  await page.waitForTimeout(2000);
  await loadAllServersOnDashboard();

  const entries = await collectServersFromDashboard();

  if (!entries.length) {
    console.error('No server entries detected on dashboard');
    await captureDiagnosticInfo('server-list-empty');
    throw new Error('No server entries detected on dashboard');
  }

  logServerEntries(entries);

  const match = findServerMatch(entries);
  if (!match) {
    console.error('Configured server not found on dashboard');
    await captureDiagnosticInfo('server-not-found');
    throw new Error(`Server not found. Host: ${config.FALIX_SERVER_HOST}${config.FALIX_SERVER_NAME ? `, Name: ${config.FALIX_SERVER_NAME}` : ''}`);
  }

  const statusInfo = determineStatusFromIndicators({
    statusCandidates: match.entry.statusCandidates,
    buttonTexts: match.entry.buttonTexts
  });

  console.log(`Matched dashboard server by ${match.matchedBy}. Status: ${statusInfo.statusText}`);

  return {
    isOffline: statusInfo.isOffline,
    statusText: statusInfo.statusText,
    matchedBy: match.matchedBy
  };
}

async function checkServerStatus() {
  const targetDescription = config.FALIX_SERVER_NAME
    ? `${config.FALIX_SERVER_NAME} (${config.FALIX_SERVER_HOST})`
    : config.FALIX_SERVER_HOST;
  console.log(`Checking server status for ${targetDescription}...`);

  try {
    const consoleResult = await attemptConsoleDetection();
    if (consoleResult.success) {
      return consoleResult.isOffline;
    }

    console.log(`Console detection unavailable: ${consoleResult.reason}`);
    const dashboardResult = await detectServerViaDashboard();
    return dashboardResult.isOffline;
  } catch (error) {
    console.error('Error checking server status:', error.message);
    await captureDiagnosticInfo('server-status-error');
    throw error;
  }
}

async function startServer() {
  console.log('Server is offline, attempting to start...');
  try {
    await gotoWithRetry(config.FALIX_CONSOLE_URL);
    await handleEnhancedCloudflareVerification();
    await page.waitForTimeout(1500);

    const startClicked = await page.evaluate(() => {
      const selectorCandidates = [
        'button[data-action="start"]',
        'button[aria-label*="start" i]',
        'button[class*="start" i]',
        '.btn-start',
        '[data-testid*="start"]',
        'button[name*="start" i]'
      ];

      for (const selector of selectorCandidates) {
        const element = document.querySelector(selector);
        if (element && typeof element.click === 'function') {
          element.click();
          return true;
        }
      }

      const candidates = document.querySelectorAll('button, .btn, input[type="button"], input[type="submit"], a[role="button"]');
      for (const element of candidates) {
        const text = (element.innerText || element.textContent || element.value || '').trim().toLowerCase();
        if (!text) continue;
        if (text.includes('start') || text.includes('power on') || text.includes('launch') || text.includes('boot')) {
          if (typeof element.click === 'function') {
            element.click();
            return true;
          }
        }
      }

      return false;
    });

    if (!startClicked) {
      throw new Error('Start button not found on console page');
    }

    console.log('Start command issued, handling potential ad modal...');
    await handleAdModal();

    console.log('Waiting for server to come online...');
    await page.waitForTimeout(5000);

    const statusData = await page.evaluate(() => {
      const getText = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
      const statusNodes = document.querySelectorAll('.status, .badge, .state, .label, [class*="status"], [class*="state"]');
      const buttonNodes = document.querySelectorAll('button, .btn, input[type="button"], input[type="submit"], a[role="button"]');

      const statusCandidates = [];
      statusNodes.forEach(node => {
        const text = getText(node);
        if (text) statusCandidates.push(text);
      });

      const buttonTexts = [];
      let startButtons = 0;
      let stopButtons = 0;
      buttonNodes.forEach(node => {
        const text = getText(node).toLowerCase();
        if (!text) return;
        buttonTexts.push(text);
        if (text.includes('start') || text.includes('power on') || text.includes('boot')) startButtons += 1;
        if (text.includes('stop') || text.includes('power off') || text.includes('shutdown')) stopButtons += 1;
      });

      const summaryLines = (getText(document.querySelector('main')) || getText(document.body))
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .slice(0, 20);

      return { statusCandidates, buttonTexts, startButtons, stopButtons, summaryLines };
    });

    const postStatus = determineStatusFromIndicators({
      statusCandidates: uniqueStrings([...statusData.statusCandidates, ...statusData.summaryLines]),
      buttonTexts: uniqueStrings(statusData.buttonTexts),
      explicitStartButtons: statusData.startButtons,
      explicitStopButtons: statusData.stopButtons
    });

    console.log(`Post-start status: ${postStatus.statusText}`);

    if (postStatus.isOffline) {
      console.log('Server start initiated, but status still appears offline. Will continue monitoring in next cycle.');
    } else {
      console.log('Server started successfully');
    }
  } catch (error) {
    console.error('Error starting server:', error.message);
    await captureDiagnosticInfo('start-server-error');
  }
}


async function handleAdModal() {
  console.log('Checking for ad modal...');
  try {
    await page.waitForTimeout(2000);
    
    const adModalExists = await page.evaluate(() => {
      const modals = document.querySelectorAll('.modal, .popup, .ad-modal, [class*="modal"], [class*="popup"], .dialog');
      for (const modal of modals) {
        if (modal.offsetParent !== null) {
          return true;
        }
      }
      return false;
    });
    
    if (adModalExists) {
      console.log('Ad modal detected, clicking to watch ad...');
      
      const adClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, .btn, input[type="button"], a');
        for (const btn of buttons) {
          const text = btn.textContent.toLowerCase();
          if (text.includes('watch') || text.includes('ad') || text.includes('continue')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (adClicked) {
        console.log(`Waiting ${config.AD_WATCH_MS}ms for ad to complete...`);
        await page.waitForTimeout(config.AD_WATCH_MS);
        
        const closeClicked = await page.evaluate(() => {
          const buttons = document.querySelectorAll('button, .btn, .close, [class*="close"], [data-dismiss]');
          for (const btn of buttons) {
            const text = btn.textContent.toLowerCase();
            if (text.includes('close') || text.includes('skip') || btn.classList.contains('close')) {
              btn.click();
              return true;
            }
          }
          return false;
        });
        
        if (closeClicked) {
          console.log('Ad modal closed');
        }
      }
    }
  } catch (error) {
    console.log('No ad modal detected or error handling ad:', error.message);
  }
}

async function checkServerStarted() {
  try {
    const isOnline = await page.evaluate(() => {
      const statusElements = document.querySelectorAll('.status, .badge, .state, [class*="status"], [class*="state"]');
      for (const element of statusElements) {
        const text = element.textContent.toLowerCase();
        if (text.includes('online') || text.includes('running') || text.includes('active')) {
          return true;
        }
      }
      return false;
    });
    return isOnline;
  } catch (error) {
    console.error('Error checking if server started:', error.message);
    return false;
  }
}

async function performKeepaliveCheck() {
  try {
    const isOffline = await checkServerStatus();
    if (isOffline) {
      await startServer();
    } else {
      console.log('Server is online, no action needed');
    }
    return true;
  } catch (error) {
    console.error('Error during keepalive check:', error.message);
    return false;
  }
}

async function runKeepaliveLoop(maxIterations = 5) {
  console.log(`Starting keepalive loop with max ${maxIterations} iterations`);
  
  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n=== Keepalive check ${i + 1}/${maxIterations} ===`);
    
    try {
      const success = await performKeepaliveCheck();
      if (!success) {
        console.log('Keepalive check failed, but continuing...');
      }
    } catch (error) {
      console.error('Keepalive check threw error:', error.message);
    }
    
    if (i < maxIterations - 1) {
      console.log(`Waiting ${config.CHECK_INTERVAL_MS}ms before next check...`);
      await page.waitForTimeout(config.CHECK_INTERVAL_MS);
    }
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
    await initializeBrowser();
    await login();
    await runKeepaliveLoop();
    console.log('\n=== Keepalive workflow completed successfully ===');
  } catch (error) {
    console.error('Fatal error in keepalive workflow:', error);
    process.exit(1);
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
