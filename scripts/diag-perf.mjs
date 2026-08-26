/* eslint-disable no-console */
// Diagnostic: detect render loops / heavy main-thread work in the addon panel.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const consoleMessages = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (['error', 'warning'].includes(msg.type())) {
    consoleMessages.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`);
  }
});
page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err.message.slice(0, 200)}`));

await page.goto('http://localhost:6008/?path=/story/example-button--primary', {
  waitUntil: 'networkidle2',
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 3000));

// open the LLM Chat panel
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="tab"], button')].find((n) =>
    n.textContent.includes('LLM Chat'),
  );
  if (el) el.click();
});
await new Promise((r) => setTimeout(r, 1500));

// instrument: count mutations of the messages container over 5s and long tasks
const metrics = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let mutations = 0;
      const observer = new MutationObserver(() => {
        mutations += 1;
      });
      const target = document.querySelector('.sb-llm-messages');
      if (target) {
        observer.observe(target, { childList: true, subtree: true, characterData: true });
      }
      let longTasks = 0;
      let longTaskTime = 0;
      try {
        const po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) {
              longTasks += 1;
              longTaskTime += entry.duration;
            }
          }
        });
        po.observe({ type: 'longtask', buffered: true });
      } catch {
        // longtask API unsupported
      }
      setTimeout(() => {
        observer.disconnect();
        resolve({ mutations, longTasks, longTaskTime: Math.round(longTaskTime) });
      }, 5000);
    }),
);

console.log('--- metrics over 5s (panel open, idle) ---');
console.log(JSON.stringify(metrics));
console.log('--- console errors/warnings ---');
console.log(consoleMessages.slice(0, 30).join('\n') || '(none)');
console.log('--- page errors ---');
console.log(pageErrors.slice(0, 10).join('\n') || '(none)');

// also check the preview iframe console
await browser.close();
