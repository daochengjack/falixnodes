const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const pRetry = require('p-retry');

puppeteer.use(StealthPlugin());

const config = {
  FALIX_EMAIL: process.env.FALIX_EMAIL,
  FALIX_PASSWORD: process.env.FALIX_PASSWORD,
  FALIX_BASE_URL: process.env.FALIX_BASE_URL || 'https://client.falixnodes.net',
  FALIX_SERVER_HOST: process.env.FALIX_SERVER_HOST || 'mikeqd.falixsrv.me',
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

async function initializeBrowser() {
  console.log('Initializing browser...');
  browser = await puppeteer.launch({
    headless: config.HEADLESS,
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
  await page.setViewport({ width: 1280, height: 720 });
  
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
}

async function login() {
  console.log('Attempting to login...');
  await page.goto(`${config.FALIX_BASE_URL}/auth/login`, { waitUntil: 'networkidle2' });
  
  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });
  await page.type('input[name="email"], input[type="email"]', config.FALIX_EMAIL);
  await page.type('input[name="password"], input[type="password"]', config.FALIX_PASSWORD);
  
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"], input[type="submit"], .btn-primary')
  ]);
  
  await handleCloudflareVerification();
  console.log('Login successful');
}

async function handleCloudflareVerification() {
  console.log('Checking for Cloudflare verification...');
  try {
    const cfVerification = await page.$('.cf-browser-verification, #cf-challenge-running, [data-ray]');
    if (cfVerification) {
      console.log('Cloudflare verification detected, waiting...');
      await page.waitForFunction(
        () => !document.querySelector('.cf-browser-verification, #cf-challenge-running, [data-ray]'),
        { timeout: 60000 }
      );
      console.log('Cloudflare verification completed');
    }
  } catch (error) {
    console.log('No Cloudflare verification or timeout reached, continuing...');
  }
}

async function checkServerStatus() {
  console.log(`Checking server status for ${config.FALIX_SERVER_HOST}...`);
  await page.goto(`${config.FALIX_BASE_URL}/`, { waitUntil: 'networkidle2' });
  
  await handleCloudflareVerification();
  
  try {
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
  } catch (error) {
    console.error('Error checking server status:', error.message);
    return false;
  }
}

async function startServer() {
  console.log('Server is offline, attempting to start...');
  await page.goto(`${config.FALIX_BASE_URL}/server/console`, { waitUntil: 'networkidle2' });
  
  await handleCloudflareVerification();
  
  try {
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
    } else {
      console.log('Server start initiated, but status not yet updated');
    }
  } catch (error) {
    console.error('Error starting server:', error.message);
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