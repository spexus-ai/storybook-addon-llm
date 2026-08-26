/* eslint-disable no-console */
// Repro: alternate between two Page stories, measure per-switch degradation.
import puppeteer from 'puppeteer';

const browserName = process.argv[2] ?? "chrome";
const headed = process.argv[3] === "headed";
const browser = await puppeteer.launch({
  browser: browserName === 'firefox' ? 'firefox' : 'chrome',
  headless: !headed,
  args: ['--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message.slice(0, 160)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
});

await page.goto('http://localhost:6008/?path=/story/example-page--logged-in', {
  waitUntil: 'networkidle2',
  timeout: 90000,
});
await new Promise((r) => setTimeout(r, 5000));

// expand the Example/Page group if collapsed, then find the two story links
const ensureLinks = async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await page.evaluate(() => {
      const group = document.querySelector('[data-item-id="example-page"]');
      if (group) group.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 500));
    const links = await page.evaluate(() => {
      const ids = ['example-page--logged-in', 'example-page--logged-out'];
      const result = {};
      for (const id of ids) {
        const el = document.querySelector(`[data-item-id="${id}"]`);
        result[id] = !!el;
      }
      return result;
    });
    if (links['example-page--logged-in'] && links['example-page--logged-out']) {
      return true;
    }
  }
  return false;
};

const ready = await ensureLinks();
console.log('story links ready:', ready);

const targets = ['example-page--logged-out', 'example-page--logged-in', 'example-page--logged-out', 'example-page--logged-in', 'example-page--logged-out', 'example-page--logged-in', 'example-page--logged-out', 'example-page--logged-in'];
let prev = 'example-page--logged-in';
for (let i = 0; i < targets.length; i += 1) {
  const id = targets[i];
  const t0 = Date.now();
  const clicked = await page.evaluate((storyId) => {
    const el = document.querySelector(`[data-item-id="${storyId}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, id);
  if (!clicked) {
    console.log(`switch ${i} to ${id}: NOT FOUND`);
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
  // wait until the preview iframe renders the new story
  let rendered = false;
  for (let w = 0; w < 40; w += 1) {
    rendered = await page.evaluate((storyId) => {
      const iframe = document.querySelector('iframe[data-is-loaded="true"]');
      if (!iframe) return false;
      return !!iframe.contentDocument?.querySelector('#storybook-root')?.childElementCount;
    }, id);
    if (rendered) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const dt = Date.now() - t0;
  prev = id;
  console.log(`switch ${i} to ${id}: ${dt}ms ${rendered ? '' : '(not rendered yet)'}`);
}

console.log('errors:', errors.slice(0, 10).join(' | ') || '(none)');
await browser.close();
