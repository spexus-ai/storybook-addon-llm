/* eslint-disable no-console */
// E2E verification for storybook-addon-llm (dev sandbox on port 6006).
// Uses the system Chrome via puppeteer-core + a mock OpenAI-compatible SSE server.
import fs from 'node:fs';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SB_URL = 'http://localhost:6008/?path=/story/example-button--primary';

// --- mock LLM server (SSE streaming, OpenAI-compatible) ---
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};
const chatRequests = [];
let lastToolRequested = 'styles';
const mockServer = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    console.log('[mock] request:', req.method, req.url, body.slice(0, 300));
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }
    if (req.url === '/chat/completions') {
      chatRequests.push(body);
      let lastUserText = '';
      try {
        const parsed = JSON.parse(body);
        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        const lastUser = [...messages].reverse().find((message) => message?.role === 'user');
        lastUserText = JSON.stringify(lastUser?.content ?? '');
      } catch {
        // ignore parse failures; fall back to substring checks below
      }
      const streamWords = (words) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...CORS,
        });
        let i = 0;
        const timer = setInterval(() => {
          if (i >= words.length) {
            clearInterval(timer);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          const payload = { choices: [{ delta: { content: words[i] } }] };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          i += 1;
        }, 80);
      };
      const write = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      // Simulate a text-only model: reject the first request that contains images.
      if (!chatRequests.some((request) => !request.includes('image_url')) && body.includes('image_url')) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: { message: 'This model does not support image' } }));
        return;
      }
      // Follow-up after tool execution: final answer.
      if (body.includes('"role":"tool"')) {
        const lastTool = lastToolRequested;
        streamWords(
          lastTool === 'file' ? ['File', ' saved!'] : lastTool === 'mcp' ? ['Docs', ' checked'] : ['Color', ' applied!'],
        );
        return;
      }
      const toolCallStream = (name, argsChunk) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...CORS,
        });
        write({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${name}`, function: { name, arguments: '' } }] }, finish_reason: null }] });
        write({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argsChunk } }] }, finish_reason: 'tool_calls' }] });
        res.write('data: [DONE]\n\n');
        res.end();
      };
      // Simulate a tool call: the user asked to change the color (temporary styles).
      if (lastUserText.includes('замени цвет')) {
        lastToolRequested = 'styles';
        toolCallStream('apply_styles', '{"selector":"button.storybook-button","styles":{"color":"blue"}}');
        return;
      }
      // Simulate a tool call: the user asked to write a project file.
      if (lastUserText.includes('запиши файл')) {
        lastToolRequested = 'file';
        toolCallStream(
          'write_project_file',
          '{"path":"node_modules/.cache/__llm-e2e-write__.txt","content":"hello from e2e"}',
        );
        return;
      }
      // Simulate a tool call to the Storybook MCP server (bridge).
      if (lastUserText.includes('какие компоненты')) {
        lastToolRequested = 'mcp';
        toolCallStream('list-all-documentation', '{}');
        return;
      }
      streamWords(['Mock', ' **answer** ', 'with', ' `code`.', ' DONE']);
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

await new Promise((resolve) => mockServer.listen(7777, resolve));
console.log('[mock] listening on :7777');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--window-size=1400,900'],
});

const failures = [];
const step = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures.push(name);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.stack || err.message}`));

  await page.goto(SB_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 1. panel tab exists
  const panelTab = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"], button')].some((el) =>
      el.textContent.includes('LLM Chat'),
    ),
  );
  step('LLM Chat panel tab is rendered', panelTab);

  // 2. open the panel
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="tab"], button')].find((node) =>
      node.textContent.includes('LLM Chat'),
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 1200));

  const emptyVisible = await page.evaluate(() =>
    document.body.textContent.includes('Chat with an LLM'),
  );
  step('Panel empty state visible', emptyVisible);

  // 3. settings modal
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim().startsWith('Settings'),
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const modalVisible = await page.evaluate(() =>
    document.body.textContent.includes('LLM connection'),
  );
  step('Settings modal opens', modalVisible);

  // fill settings with the mock server
  const setInput = async (label, value) => {
    await page.evaluate(
      ({ l, v }) => {
        const labels = [...document.querySelectorAll('.sb-llm-modal-field')];
        const field = labels.find((f) => f.textContent.includes(l));
        const input = field?.querySelector('input, textarea');
        if (!input) throw new Error(`field not found: ${l}`);
        const setter = Object.getOwnPropertyDescriptor(
          input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value',
        ).set;
        setter.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { l: label, v: value },
    );
  };
  await setInput('Base URL', 'http://localhost:7777');
  await setInput('API key', 'test-key');
  await setInput('Model', 'mock-model');
  await new Promise((r) => setTimeout(r, 300));

  // test connection
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim().startsWith('Test connection'),
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const testOk = await page.evaluate(() =>
    document.body.textContent.includes('Connected'),
  );
  step('Test connection against mock API', testOk);

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Done',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // 4. pick an element from the story iframe
  await page.evaluate(() => {
    const el = document.querySelector('.sb-llm-pick-btn');
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 800));

  const frame = page.frames().find((f) => f.url().includes('iframe.html'));
  if (!frame) throw new Error('preview iframe not found');
  const pickingActive = await frame.evaluate(() =>
    document.body.classList.contains('storybook-addon-llm-picking'),
  );
  step('Picking mode active in preview iframe', pickingActive);

  const btnBox = await frame.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (!btnBox) throw new Error('no button element in story');
  await frame.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const rect = el.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }),
    );
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  });
  await new Promise((r) => setTimeout(r, 2500));

  const chipVisible = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.sb-llm-chip')];
    return chips.some((chip) => chip.textContent.includes('button'));
  });
  step('Element chip added after picking', chipVisible);

  const chipImg = await page.evaluate(() => {
    const img = document.querySelector('.sb-llm-chip-img');
    return img ? img.src : null;
  });
  step('Chip has a screenshot', !!chipImg && chipImg.startsWith('data:image/png'), chipImg ? chipImg.slice(0, 30) + '…' : 'no img');

  // 4b. Escape cancels picking mode
  await page.evaluate(() => {
    const el = document.querySelector('.sb-llm-pick-btn');
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const pickingAgain = await frame.evaluate(() =>
    document.body.classList.contains('storybook-addon-llm-picking'),
  );
  step('Picking mode re-enabled', pickingAgain);
  await frame.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  await new Promise((r) => setTimeout(r, 500));
  const cancelledInFrame = await frame.evaluate(() =>
    document.body.classList.contains('storybook-addon-llm-picking'),
  );
  const cancelledInPanel = await page.evaluate(() => {
    const el = document.querySelector('.sb-llm-pick-btn');
    return el ? !el.classList.contains('sb-llm-pick-btn-active') : true;
  });
  step('Escape cancels picking (iframe)', !cancelledInFrame);
  step('Escape cancels picking (panel button state)', cancelledInPanel);

  // 5. send a message and receive a streamed answer
  await page.type('.sb-llm-input-row textarea', 'Hello mock model');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Send',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 3000));

  const assistantReplied = await page.evaluate(() =>
    document.body.textContent.includes('Mock'),
  );
  step('Assistant streamed reply rendered', assistantReplied);

  const retryNote = await page.evaluate(() =>
    document.body.textContent.includes('does not support images'),
  );
  step('Auto-retry note rendered (text-only fallback)', retryNote);

  const screenshotsOff = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('storybook-addon-llm:settings')).sendScreenshots === false;
    } catch {
      return false;
    }
  });
  step('Screenshots toggle auto-disabled after rejection', screenshotsOff);

  const retryWithoutImages =
    chatRequests.length >= 2 && !chatRequests[chatRequests.length - 1].includes('image_url');
  step('Retry request sent without image parts', retryWithoutImages);

  const lastRequest = chatRequests[chatRequests.length - 1] ?? '';
  const storyContextSent =
    lastRequest.includes('Story file: `src/stories/Button.stories.ts`') &&
    lastRequest.includes('Storybook URL: http://localhost:6008');
  step('Story file path and page URL included in the request context', storyContextSent);

  const markdownRendered = await page.evaluate(() => {
    const content = document.querySelector('.sb-llm-msg-assistant .sb-llm-msg-content');
    return !!content?.querySelector('strong, code, pre');
  });
  step('Markdown rendered in reply', markdownRendered);

  const userAttachShown = await page.evaluate(() => {
    const user = document.querySelector('.sb-llm-msg-user');
    return !!user?.querySelector('.sb-llm-msg-attachment img');
  });
  step('User message shows attached element screenshot', userAttachShown);

  // 6. tool calling: the model changes the story via apply_styles
  await page.type('.sb-llm-input-row textarea', 'замени цвет на синий');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Send',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 2500));

  const overrideApplied = await frame.evaluate(() => {
    const style = document.getElementById('storybook-addon-llm-overrides');
    return style
      ? style.textContent.includes('color: blue') && style.textContent.includes('button.storybook-button')
      : false;
  });
  step('CSS override injected into the preview iframe', overrideApplied);

  const toolRow = await page.evaluate(() => {
    const el = document.querySelector('.sb-llm-msg-tool');
    return el ? el.textContent ?? '' : null;
  });
  step(
    'Tool execution shown in chat',
    !!toolRow && toolRow.includes('apply_styles') && toolRow.includes('Applied'),
    toolRow ?? 'no tool row',
  );

  const finalReply = await page.evaluate(() => document.body.textContent.includes('Color applied'));
  step('Final reply rendered after tool call', finalReply);

  // 7. file tools: the model writes a project file through the local file server
  const writtenFile = 'node_modules/.cache/__llm-e2e-write__.txt';
  try {
    fs.rmSync(writtenFile, { force: true });
  } catch {
    // ignore
  }
  await page.type('.sb-llm-input-row textarea', 'запиши файл в node_modules/.cache');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Send',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 2500));

  const fileExists = fs.existsSync(writtenFile);
  const fileContent = fileExists ? fs.readFileSync(writtenFile, 'utf8') : '';
  step('Project file written to disk via tool', fileExists && fileContent === 'hello from e2e', fileContent);
  const fileToolRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sb-llm-msg-tool')];
    return rows.some((row) => row.textContent.includes('write_project_file') && row.textContent.includes('Wrote'));
  });
  step('File tool execution shown in chat', fileToolRow);

  // 8. MCP bridge: the model calls the Storybook MCP server tool
  await page.type('.sb-llm-input-row textarea', 'какие компоненты есть в проекте');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Send',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 4000));

  const mcpToolRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sb-llm-msg-tool')];
    return rows.map((row) => row.textContent ?? '');
  });
  const mcpCalled = mcpToolRow.some((text) => text.includes('list-all-documentation'));
  step('MCP tool called through the bridge', mcpCalled, mcpCalled ? 'ok' : mcpToolRow.join(' | ').slice(0, 200));
  const mcpResultUseful = mcpToolRow.some(
    (text) => text.includes('button') || text.includes('Button'),
  );
  step('MCP tool result contains component docs', mcpResultUseful);
  const mcpReply = await page.evaluate(() => document.body.textContent.includes('Docs checked'));
  step('Final reply rendered after MCP tool call', mcpReply);
  const statusChips = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.sb-llm-status')];
    return chips.map((chip) => chip.textContent ?? '');
  });
  step('Header shows MCP/files status', statusChips.some((text) => text.includes('MCP')), statusChips.join(' | '));

  // 9. Codex CLI provider (mock binary)
  const MOCK_CODEX = new URL('./mock-codex.sh', import.meta.url).pathname;
  fs.writeFileSync('/tmp/mock-codex-args.log', '');

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim().startsWith('Settings'),
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Codex CLI',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(
    (path) => {
      const field = [...document.querySelectorAll('.sb-llm-modal-field')].find((f) =>
        f.textContent.includes('Codex binary path'),
      );
      const input = field?.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, path);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    MOCK_CODEX,
  );
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Done',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  await page.type('.sb-llm-input-row textarea', 'позови кодекс');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Send',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 2500));

  const codexReplied = await page.evaluate(() =>
    document.body.textContent.includes('Hello from mock codex'),
  );
  step('Codex reply rendered', codexReplied);
  const codexToolRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sb-llm-msg-tool')];
    return rows.some(
      (row) => row.textContent.includes('command_execution') && row.textContent.includes('git status'),
    );
  });
  step('Codex command execution shown in chat', codexToolRow);

  await page.type('.sb-llm-input-row textarea', 'продолжи');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim() === 'Send',
    );
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 2500));

  const codexResumed = await page.evaluate(() =>
    document.body.textContent.includes('Resumed session'),
  );
  step('Codex session resumed on second message', codexResumed);

  const codexLog = fs.readFileSync('/tmp/mock-codex-args.log', 'utf8');
  step('Resume passed the session id to codex', codexLog.includes('resume thread-123'));
  step('Approve-for-me flag passed to codex', codexLog.includes('--approve-for-me'));
  step('No conflicting --sandbox flag with approve-for-me', !codexLog.includes('--sandbox workspace-write'));
  step('Prompt passed to codex', codexLog.includes('позови кодекс'));

  // 7. no console errors (the deliberate 400 from the image-rejection
  // simulation shows up as a resource-load error and is expected)
  const relevantErrors = consoleErrors.filter(
    (err) =>
      !err.includes('favicon') &&
      !err.includes('WebSocket') &&
      !err.includes('net::ERR') &&
      !err.includes('React DevTools') &&
      !err.includes('Failed to load resource'),
  );
  step('No console errors in manager', relevantErrors.length === 0, relevantErrors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  mockServer.close();
  try {
    fs.rmSync('node_modules/.cache/__llm-e2e-write__.txt', { force: true });
  } catch {
    // ignore
  }
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED: ${failures.join(', ')}`);
  process.exit(1);
} else {
  console.log('\nALL E2E CHECKS PASSED');
}
