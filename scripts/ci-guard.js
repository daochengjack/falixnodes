const { execSync } = require('child_process');
const fs = require('fs');

const uppercaseToken = ['DOM', 'Content', 'Loaded'].join('');
const allowedTokens = new Set(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']);
const waitUntilPattern = /waitUntil\s*:\s*(\[[^\]]+\]|['"][^'"]+['"])/g;
const quotedTokenPattern = /['"]([^'"]+)['"]/g;

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const errors = [];

for (const file of trackedFiles) {
  if (file.startsWith('.git/')) {
    continue;
  }

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    continue;
  }

  if (content.includes(uppercaseToken)) {
    errors.push(`${file}: contains forbidden token ${uppercaseToken}`);
  }

  let match;
  while ((match = waitUntilPattern.exec(content)) !== null) {
    const block = match[1];
    const tokens = [];
    let tokenMatch;

    while ((tokenMatch = quotedTokenPattern.exec(block)) !== null) {
      tokens.push(tokenMatch[1]);
    }

    if (tokens.length === 0) {
      continue;
    }

    for (const token of tokens) {
      const normalized = token.toLowerCase();
      if (!allowedTokens.has(normalized) || token !== normalized) {
        errors.push(`${file}: invalid waitUntil token "${token}"`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('CI guard detected invalid waitUntil usage:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('CI guard passed: waitUntil usage is normalized.');
