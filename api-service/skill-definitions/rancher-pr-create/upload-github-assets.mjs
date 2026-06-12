// Upload files to GitHub user-attachments via the browser sidecar.
//
// Simulates drag-and-drop by setting files on the hidden <input type="file">
// inside a GitHub PR/issue edit form. GitHub processes the upload and inserts
// a user-attachments URL into the textarea. We capture those URLs and print
// them as tab-separated lines: filename\thref
//
// Usage:
//   node upload-github-assets.mjs <github-pr-or-issue-url> <file1> [file2] ...
//
// Prerequisites:
//   - Browser sidecar running with synced GitHub session (wait-for-sidecars browser)
//   - CLAUDE_BROWSER_CDP env var set (default: http://localhost:9222)
//
// Output (stdout, one line per file):
//   repro.webm\thttps://github.com/user-attachments/assets/<uuid>
//   fix.webm\thttps://github.com/user-attachments/assets/<uuid>

import { chromium } from 'playwright-core';
import { basename } from 'node:path';

const CDP = process.env.CLAUDE_BROWSER_CDP || 'http://localhost:9222';
const targetUrl = process.argv[2];
const filePaths = process.argv.slice(3);

if (!targetUrl || filePaths.length === 0) {
  console.error('Usage: node upload-github-assets.mjs <github-pr-or-issue-url> <file1> [file2] ...');
  process.exit(1);
}

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();

try {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Open edit mode on the first comment (PR/issue body)
  const kebab = page.locator('.timeline-comment-header details summary').first();
  await kebab.click();
  await page.waitForTimeout(1000);
  const editItem = page.getByRole('menuitem', { name: /edit/i }).first();
  if (await editItem.count() > 0) {
    await editItem.click();
    await page.waitForTimeout(2000);
  }

  // Find the textarea and file input inside the edit form
  const textarea = page.locator('.js-comment-update textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10000 });
  const fileInput = page.locator('.js-comment-update input[type="file"]').first();

  const originalBody = await textarea.inputValue();

  // Upload each file, collecting the generated user-attachments URLs
  const results = [];

  for (const fp of filePaths) {
    const name = basename(fp);
    const beforeVal = await textarea.inputValue();

    await fileInput.setInputFiles(fp);

    // Poll until GitHub finishes uploading and inserts the URL
    let url = null;
    for (let tick = 0; tick < 60; tick++) {
      await page.waitForTimeout(1000);
      const currentVal = await textarea.inputValue();
      if (currentVal === beforeVal) continue;
      if (currentVal.includes('Uploading')) continue;

      const allUrls = currentVal.match(/https:\/\/github\.com\/user-attachments\/assets\/[^\s)>\]]+/g) || [];
      const prevUrls = beforeVal.match(/https:\/\/github\.com\/user-attachments\/assets\/[^\s)>\]]+/g) || [];
      const newUrls = allUrls.filter(u => !prevUrls.includes(u));

      if (newUrls.length > 0) {
        url = newUrls[0];
        break;
      }
    }

    if (url) {
      results.push({ name, url });
      console.log(`${name}\t${url}`);
    } else {
      console.error(`FAILED\t${name}`);
    }
  }

  // Restore the original body and cancel edit (caller uses the URLs separately)
  await textarea.fill(originalBody);
  await page.waitForTimeout(500);
  const cancelBtn = page.locator('button.js-comment-cancel-button').first();
  if (await cancelBtn.count() > 0) {
    await cancelBtn.click();
  }
} finally {
  await page.close();
  await browser.close();
}
