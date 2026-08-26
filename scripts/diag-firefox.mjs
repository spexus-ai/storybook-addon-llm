/* eslint-disable no-console */
// Diagnostic: story switching under Firefox.
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  browser: 'firefox',
  headless: true,
  args: ['--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const consoleErrors = [];
page.on('console', (msg) => {
  if (['error', 'warning'].includes(msg.type())) {
    consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`);
  }
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message.slice(0, 200)}`));

await page.goto('http://localhost:6008/?path=/story/example-button--primary', {
  waitUntil: 'networkidle2',
  timeout: 90000,
});
await new Promise((r) => setTimeout(r, 6000));

await page.evaluate(() => {
  window.__lt = { count: 0, total: 0, max: 0 };
  const po = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > 100) {
        window.__lt.count += 1;
        window.__lt.total += entry.duration;
        window.__lt.max = Math.max(window.__lt.max, entry.duration);
      }
    }
  });
  po.observe({ type: 'longtask', buffered: true });
});

const stories = [
  'example-button--secondary',
  'example-button--large',
  'example-header--logged-in',
  'example-header--logged-out',
  'example-page--logged-in',
  'example-button--primary',
];

for (const id of stories) {
  const t0 = Date.now();
  const clicked = await page.evaluate((storyId) => {
    const link = document.querySelector(`[href*="path=/story/${storyId}"]`);
    if (!link) return false;
    link.click();
    return true;
  }, id);
  if (!clicked) {
    console.log(`switch to ${id}: sidebar item not found`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 700));
  console.log(`switch to ${id}: ${Date.now() - t0}ms (wall)`);
}

const lt = await page.evaluate(() => window.__lt);
console.log('long tasks >100ms:', JSON.stringify(lt));
console.log('console:', consoleErrors.slice(0, 20).join(' | ') || '(none)');
await browser.close();
