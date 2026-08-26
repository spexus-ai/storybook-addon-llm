/* eslint-disable no-console */
// Reproduce the CORS error on /codex/run from a cross-origin page (Firefox).
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  browser: 'firefox',
  headless: true,
  args: ['--window-size=1400,900'],
});
const page = await browser.newPage();
await page.goto('http://localhost:6008/?path=/story/example-button--primary', {
  waitUntil: 'networkidle2',
  timeout: 90000,
});
await new Promise((r) => setTimeout(r, 3000));

const result = await page.evaluate(async () => {
  const mockCodex = '/Users/dvaletin/development/storybook-llm-deepseek/scripts/mock-codex.sh';
  const out = { preflightStatus: null, runStatus: null, runError: null, health: null };
  try {
    const pre = await fetch('http://127.0.0.1:6050/codex/run', {
      method: 'OPTIONS',
    });
    out.preflightStatus = pre.status;
    out.preflightHeaders = {
      acao: pre.headers.get('access-control-allow-origin'),
      acam: pre.headers.get('access-control-allow-methods'),
      acah: pre.headers.get('access-control-allow-headers'),
    };
  } catch (e) {
    out.preflightError = String(e);
  }
  try {
    const h = await fetch('http://127.0.0.1:6050/health');
    out.health = h.status;
  } catch (e) {
    out.health = String(e);
  }
  try {
    const response = await fetch('http://127.0.0.1:6050/codex/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'test',
        codexPath: mockCodex,
        sandbox: 'workspace-write',
        approveForMe: true,
        skipGitCheck: false,
        keepSession: false,
        model: '',
        sessionId: '',
      }),
    });
    out.runStatus = response.status;
    const text = await response.text();
    out.runBody = text.slice(0, 400);
  } catch (e) {
    out.runError = String(e);
  }
  return out;
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
