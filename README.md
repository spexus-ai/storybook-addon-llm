# storybook-addon-llm

Chat with LLMs right inside Storybook: pick an element of the open story, ask questions, and let the model edit your project. Two providers: any **OpenAI-compatible API** (DeepSeek, OpenAI, Ollama, …) or the local **Codex CLI** agent.

## Install

### 1. Requirements

- Storybook 9 or newer (MCP bridge needs 9.1.16+)
- **API provider**: an OpenAI-compatible endpoint reachable from the browser (CORS must be enabled; OpenAI and DeepSeek allow it; for Ollama run `OLLAMA_ORIGINS=http://localhost:6006 ollama serve`)
- **Codex provider**: [Codex CLI](https://developers.openai.com/codex/cli) installed and authenticated (`codex login`), project inside a git repository
- **MCP bridge** (optional): `@storybook/addon-mcp` in `.storybook/main.ts` + dev server running

### 2. Install the addon

```bash
npm install --save-dev storybook-addon-llm
```

### 3. Register it in `.storybook/main.ts`

```ts
export default {
  addons: ['storybook-addon-llm'],
};
```

With options (all optional):

```ts
export default {
  addons: [
    {
      name: 'storybook-addon-llm',
      options: {
        fileTools: true, // allow the model to read/write project files (default)
        fileServerPort: 6050, // local file server port (default; next ports are tried too)
      },
    },
  ],
};
```

### 4. Optional: Storybook MCP bridge

```bash
npx storybook add @storybook/addon-mcp
```

```ts
// .storybook/main.ts
export default {
  addons: ['@storybook/addon-mcp', 'storybook-addon-llm'],
};
```

The panel will automatically expose the MCP tools (`list-all-documentation`, `get-documentation`, `get-storybook-story-instructions`, `preview-stories`, `run-story-tests`, …) to the model.

### 5. Start Storybook and configure the model

```bash
npm run storybook
```

Open the **LLM Chat** panel → **Settings**:

- **API provider**: pick a preset (DeepSeek / OpenAI) or enter a custom base URL, paste the API key, choose the model, click **Test connection**.
- **Codex CLI provider**: switch the provider toggle to Codex CLI, pick the sandbox mode (`workspace-write` to let it edit files), optionally set a model. Codex uses your existing `~/.codex` auth.

### 6. Chat

Click **Pick element** (panel header or toolbar), click any element of the story, then ask a question. The element's HTML, computed styles and screenshot, plus the story file path, URL, source code, args and argTypes are attached automatically.

## Features

- Chat panel with streaming responses (SSE) and markdown rendering
- **Two providers**: OpenAI-compatible API (streaming + tool calling + vision screenshots) and Codex CLI (full local agent: edits files itself, runs commands, resumes its session between messages)
- Element picker: click a rendered element of the story (Esc cancels) to add it to the chat context; snapshots include `outerHTML`, `innerText`, computed styles, bounding box, ARIA attributes and a PNG screenshot
- **Tool calling** (API provider):
  - `update_story_args` — changes story props via Storybook controls
  - `apply_styles` / `reset_styles` — temporary CSS overrides in the preview
  - `list_project_files` / `read_project_file` / `write_project_file` — permanent source edits on disk, hot-reloaded by Storybook
  - Storybook MCP tools via the bridge
  - Every tool execution is shown in the chat
- Automatic fallback for text-only models (DeepSeek, …): image attachments rejected → request re-sent with text/HTML context, screenshots toggle switched off
- Settings stored in `localStorage`; API key is sent only to the configured base URL
- Stop button (AbortController) to cancel in-flight requests

## Usage tips

- Add several elements before sending — all chips are attached to the next message.
- Ask for changes, not just explanations: "сделай текст синим" → `apply_styles` (temporary) or `read_project_file` + `write_project_file` (permanent); "поменяй label на Save" → `update_story_args`; "какие компоненты есть в проекте?" → MCP `list-all-documentation`.
- The model sees the open story's file path and Storybook URL, so "add two buttons to the open page" resolves to the right file.
- Disable **Send element screenshots** for text-only models — or leave it on: the rejection is detected, the retry happens automatically.

## Codex CLI provider

Pick **Codex CLI** in Settings → Provider. The panel talks to the addon's local server, which spawns `codex exec --json` in the project directory and streams events (agent messages, command executions, file changes) into the chat.

| Setting | Description |
| --- | --- |
| Codex binary path | Default `codex` (from PATH); set an absolute path to override |
| Sandbox mode | `read-only` (chat only), `workspace-write` (edit project files, default), `danger-full-access` |
| Model | Empty = codex default; e.g. `gpt-5.2-codex` |
| Keep one session | Resume the same codex thread across messages (memory); cleared by **Clear** |
| Auto-approve commands | `--approve-for-me` (workspace-write sandbox) |
| Skip git-repo check | `--skip-git-repo-check` for projects outside a git repository |

To give codex access to your Storybook docs, register the MCP endpoint in `~/.codex/config.toml`:

```toml
[mcp_servers.storybook]
url = "http://localhost:6006/mcp"
```

## Project editing

The addon's preset starts a local HTTP server (`127.0.0.1:6050` by default) that provides `list`/`read`/`write` file access restricted to the project root (no traversal outside). The API provider gets `list_project_files`, `read_project_file` and `write_project_file` tools; writes are saved to disk and hot-reloaded by Storybook. The Codex provider edits files with its own tools.

## Configuration

| Setting | Description |
| --- | --- |
| Provider | OpenAI-compatible API or Codex CLI |
| Base URL | e.g. `https://api.deepseek.com`, `https://api.openai.com/v1`, `http://localhost:11434/v1` (Ollama) |
| API key | Stored in `localStorage` only |
| Model | e.g. `deepseek-chat`, `gpt-4o`, `llama3.1` |
| Send element screenshots | Include PNG screenshots for vision models |
| Project editing / file server port | Allow the model to read/write project files |
| Storybook MCP bridge / MCP URL | Expose Storybook MCP tools; empty URL = current origin `/mcp` |
| System prompt | Editable system prompt |

## Security

The API key lives in your browser's `localStorage` and is sent exclusively as a `Bearer` token to the base URL you configured. The file server binds to `127.0.0.1`, accepts CORS from localhost-origin pages, and refuses any path outside the project root. Codex runs locally with your `~/.codex` auth and its own sandbox policy. Never expose Storybook to untrusted users with a key configured.

## Known limitations

- Tool calling (API provider) requires a model with OpenAI-compatible function calling. If the model ignores tools, it will just answer with instructions.
- The MCP bridge requires the Storybook dev server (the `/mcp` endpoint is not available in static builds) and `@storybook/addon-mcp`.
- `apply_styles` overrides are session-scoped and lost on reload — use `write_project_file` (API provider) or Codex for permanent changes.
- Screenshots use [html2canvas](https://html2canvas.hertzen.com/) and may fail for web components with closed shadow roots, `oklch()` colors (e.g. Tailwind v4) or cross-origin images. The addon degrades to HTML-only context.
- The panel is available in story view mode; element picking targets the story canvas.

## Development

```bash
npm install
npm run start      # builds the addon in watch mode and serves the sandbox Storybook
npm test           # unit tests (vitest)
npm run test:e2e   # E2E checks against the sandbox (requires the sandbox running and system Chrome)
npm run lint
npm run build
```

The `scripts/e2e-verify.mjs` script drives a headless Chrome (via `puppeteer-core`), spins up a mock OpenAI-compatible SSE server and verifies the full flow: panel rendering, settings, element picking with screenshot, context in the request body, streaming replies, tool calling (temporary styles, project file write, Storybook MCP bridge), the Codex provider (mock binary) and Escape cancellation.

## License

MIT
