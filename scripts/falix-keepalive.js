const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const config = {
  FALIX_EMAIL: process.env.FALIX_EMAIL,
  FALIX_PASSWORD: process.env.FALIX_PASSWORD,
  FALIX_BASE_URL: process.env.FALIX_BASE_URL || 'https://client.falixnodes.net',
  FALIX_SERVER_HOST: process.env.FALIX_SERVER_HOST || 'mikeqd.falixsrv.me',
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 120000,
  AD_WATCH_MS: parseInt(process.env.AD_WATCH_MS) || 35000,
  HEADLESS: process.env.HEADLESS !== 'false',
  DEBUG_KEEPALIVE: process.env.DEBUG_KEEPALIVE === 'true'
};

if (!config.FALIX_EMAIL || !config.FALIX_PASSWORD) {
  console.error('FALIX_EMAIL and FALIX_PASSWORD environment variables are required');
  process.exit(1);
}

function debugLog(message) {
  if (config.DEBUG_KEEPALIVE) {
    console.log(`[DEBUG] ${message}`);
  }
}

async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseTimeout = 2000,
    multiplier = 2,
    onFailedAttempt = null
  } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      debugLog(`Attempt ${attempt} of ${maxRetries + 1}`);
      const result = await fn();
      if (attempt > 1) {
        debugLog(`Attempt ${attempt} succeeded`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const retriesLeft = maxRetries + 1 - attempt;
      
      debugLog(`Attempt ${attempt} failed: ${error.message}`);
      
      if (onFailedAttempt) {
        await onFailedAttempt({
          attemptNumber: attempt,
          retriesLeft,
          error
        });
      }
      
      if (retriesLeft > 0) {
        // Exponential backoff with jitter
        const exponentialDelay = baseTimeout * Math.pow(multiplier, attempt - 1);
        const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
        const delay = exponentialDelay + jitter;
        
        debugLog(`Waiting ${Math.round(delay)}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        debugLog(`All ${maxRetries + 1} attempts failed`);
        throw lastError;
      }
    }
  }
}

let browser;
let page;

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
  await page.setViewport({ width: 1366, height: 768 });
  
  // Set realistic user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);
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
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      console.log('Clicked login button by text content');
      return true;
    }
    
    for (const selector of loginSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
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
      await page.goto(`${config.FALIX_BASE_URL}/auth/login`, { 
        waitUntil: ['DOMContentLoaded', 'networkidle2'],
        timeout: 45000 
      });
      
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
        emailElement.frame.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }),
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
    maxRetries: 3,
    baseTimeout: 2000,
    multiplier: 2,
    onFailedAttempt: async (error) => {
      console.log(`Login attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
      if (error.attemptNumber > 1) {
        await page.reload();
      }
    }
  });
}

async function handleEnhancedCloudflareVerification() {
  return withRetry(async () => {
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
          return true;
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
    return true;
  }, {
    maxRetries: 2,
    baseTimeout: 1000,
    multiplier: 1.5,
    onFailedAttempt: async (error) => {
      debugLog(`Cloudflare verification attempt ${error.attemptNumber} failed: ${error.error.message}`);
    }
  });
}

async function handleCloudflareVerification() {
  // Keep the original function for backward compatibility
  return handleEnhancedCloudflareVerification();
}

async function checkServerStatus() {
  return withRetry(async () => {
    console.log(`Checking server status for ${config.FALIX_SERVER_HOST}...`);
    
    await page.goto(`${config.FALIX_BASE_URL}/`, { 
      waitUntil: ['DOMContentLoaded', 'networkidle2'],
      timeout: 45000 
    });
    
    await handleEnhancedCloudflareVerification();
    
    await page.waitForTimeout(3000);
    
    const serverStatus = await page.evaluate((serverHost) => {
      const allText = document.body.textContent || document.body.innerText || '';
      
      if (!allText.includes(serverHost)) {
        return { found: false, reason: 'Server not found on page' };
      }
      
      const serverElements = document.querySelectorAll('*');
      for (const element of serverElements) {
        const text = element.textContent || '';
        if (text.includes(serverHost)) {
          const parent = element.closest('tr, .server-item, .server-card, .card, .list-item, div[class*="server"]');
          if (parent) {
            const statusElements = parent.querySelectorAll('*');
            for (const statusEl of statusElements) {
              const statusText = (statusEl.textContent || '').toLowerCase();
              const statusClasses = (statusEl.className || '').toLowerCase();
              
              if (statusText.includes('offline') || statusText.includes('stopped') || statusText.includes('down') ||
                  statusClasses.includes('offline') || statusClasses.includes('stopped') || statusClasses.includes('down')) {
                return { found: true, isOffline: true, statusText: statusText };
              }
              
              if (statusText.includes('online') || statusText.includes('running') || statusText.includes('active') ||
                  statusClasses.includes('online') || statusClasses.includes('running') || statusClasses.includes('active')) {
                return { found: true, isOffline: false, statusText: statusText };
              }
            }
          }
        }
      }
      
      return { found: true, isOffline: false, statusText: 'Unknown - assuming online' };
    }, config.FALIX_SERVER_HOST);
    
    if (!serverStatus.found) {
      console.log(`Server ${config.FALIX_SERVER_HOST} not found on dashboard: ${serverStatus.reason}`);
      return false;
    }
    
    console.log(`Server status: ${serverStatus.statusText}`);
    return serverStatus.isOffline;
  }, {
    maxRetries: 2,
    baseTimeout: 1000,
    multiplier: 1.5,
    onFailedAttempt: async (error) => {
      console.log(`Server status check attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
      await captureDiagnosticInfo('server-status-error');
    }
  });
}

async function startServer() {
  return withRetry(async () => {
    console.log('Server is offline, attempting to start...');
    
    await page.goto(`${config.FALIX_BASE_URL}/server/console`, { 
      waitUntil: ['DOMContentLoaded', 'networkidle2'],
      timeout: 45000 
    });
    
    await handleEnhancedCloudflareVerification();
    
    await page.waitForTimeout(2000);
    
    const startButton = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, .btn, input[type="button"], input[type="submit"]');
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('start') || text.includes('run') || text.includes('launch')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (!startButton) {
      console.log('Start button not found, trying alternative selectors...');
      await page.click('button[class*="start"], .btn-start, [data-action="start"], input[value*="Start"]');
    }
    console.log('Start button clicked');
    
    await handleAdModal();
    
    console.log('Waiting for server to start...');
    await page.waitForTimeout(5000);
    
    const isStarted = await checkServerStarted();
    if (isStarted) {
      console.log('Server started successfully');
      return true;
    } else {
      console.log('Server start initiated, but status not yet updated');
      return true; // Still consider success since button was clicked
    }
  }, {
    maxRetries: 2,
    baseTimeout: 1500,
    multiplier: 2,
    onFailedAttempt: async (error) => {
      console.log(`Start server attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
      await captureDiagnosticInfo('start-server-error');
    }
  });
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