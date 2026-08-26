/* eslint-disable no-console */
// Benchmark: measure main-thread load while a long answer streams into the panel.
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};
const mock = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end('{"data":[{"id":"bench"}]}');
      return;
    }
    if (req.url === '/chat/completions') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        ...CORS,
        'Cache-Control': 'no-cache',
      });
      let i = 0;
      const total = 400;
      const timer = setInterval(() => {
        if (i >= total) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        const chunk = i % 5 === 0 ? '\n## Heading ' + i + '\n\nSome `code` **bold** text in markdown. ' : 'word ';
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
        i += 1;
      }, 5);
      return;
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise((r) => mock.listen(7788, r));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://localhost:6008/?path=/story/example-button--primary', {
  waitUntil: 'networkidle2',
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="tab"], button')].find((n) =>
    n.textContent.includes('LLM Chat'),
  );
  if (el) el.click();
});
await new Promise((r) => setTimeout(r, 1200));
// point the panel at the bench mock
await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((n) =>
    n.textContent.trim().startsWith('Settings'),
  );
  if (el) el.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const setField = (l, v) => {
    const field = [...document.querySelectorAll('.sb-llm-modal-field')].find((f) =>
      f.textContent.includes(l),
    );
    const input = field?.querySelector('input, textarea');
    const setter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setField('Base URL', 'http://localhost:7788');
  setField('API key', 'k');
  setField('Model', 'bench');
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Done');
  if (el) el.click();
});
await new Promise((r) => setTimeout(r, 400));

// measure during the stream
const metricsPromise = page.evaluate(
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
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            longTasks += 1;
            longTaskTime += entry.duration;
          }
        }
      });
      po.observe({ type: 'longtask', buffered: true });
      window.__stopBench = () => {
        observer.disconnect();
        po.disconnect();
        resolve({ mutations, longTasks, longTaskTime: Math.round(longTaskTime) });
      };
    }),
);
await page.type('.sb-llm-input-row textarea', 'bench long answer');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Send');
  if (el) el.click();
});
const t0 = Date.now();
await new Promise((r) => setTimeout(r, 3500));
await page.evaluate(() => window.__stopBench());
const metrics = await metricsPromise;
const wall = Date.now() - t0;
console.log('STREAM METRICS (400 chunks / ~3.5s):', JSON.stringify({ ...metrics, wall }));
await browser.close();
mock.close();
