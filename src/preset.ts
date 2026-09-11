import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FileServerOptions {
  /** Enable the project file tools. Default: true. */
  fileTools?: boolean;
  /** Base port for the local file server. Default: 6050. */
  fileServerPort?: number;
  /** Project root for file access. Default: process.cwd(). */
  fileRoot?: string;
  /** Server-side Codex configuration. Default: .storybook/codex.config.json. */
  codexConfigFile?: string;
}

const DEFAULT_PORT = 6050;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface FileServerState {
  port: number;
  root: string;
  server: Server;
}

/**
 * Resolves a user-supplied path against the project root and returns the
 * absolute path, or null when it escapes the root.
 */
export function resolveProjectPath(root: string, input: string): string | null {
  const resolved = path.resolve(root, input || '.');
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-codex-path',
};

function sendJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(body);
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error('Invalid JSON body');
  }
}

async function createFileServer(options: FileServerOptions): Promise<FileServerState | null> {
  const root = path.resolve(options.fileRoot ?? process.cwd());
  const basePort = options.fileServerPort ?? DEFAULT_PORT;
  const configPath = path.resolve(root, options.codexConfigFile ?? '.storybook/codex.config.json');
  const projectKey = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const sessionStorePath = path.join(os.homedir(), '.codex', 'storybook-addon-llm', `${projectKey}.json`);
  let codexVersion: string | null = null;
  const codexCache = new Map<string, string | null>();
  let sessionWriteChain: Promise<void> = Promise.resolve();

  const isExecutable = async (candidate: string): Promise<boolean> => {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Resolves the codex binary: an explicit user-provided path wins; the
   * default 'codex' is resolved against PATH (via the spawn test) and a few
   * common install locations. Results are cached per preferred value.
   */
  const resolveCodex = async (preferred: string): Promise<string | null> => {
    const key = (preferred ?? '').trim() || 'codex';
    if (codexCache.has(key)) {
      return codexCache.get(key) ?? null;
    }
    const preferredPath = key === 'codex' ? '' : key;
    let result: string | null = null;

    if (preferredPath) {
      const expanded = preferredPath.startsWith('~/') ? path.join(os.homedir(), preferredPath.slice(2)) : preferredPath;
      // keep the explicit path even if not executable so the spawn error
      // is reported verbatim
      result = expanded;
      codexCache.set(key, result);
      return result;
    }

    const onPath = await new Promise<string | null>((resolve) => {
      const child = spawn('codex', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on('error', () => resolve(null));
      child.on('exit', () => resolve(output.trim() ? 'codex' : null));
      setTimeout(() => resolve(null), 5000);
    });
    if (onPath) {
      result = onPath;
      codexCache.set(key, result);
      return result;
    }

    const home = os.homedir();
    const candidates = [
      path.join(home, '.hermes', 'node', 'bin', 'codex'),
      path.join(home, '.local', 'bin', 'codex'),
      path.join(home, '.npm-global', 'bin', 'codex'),
      path.join(home, '.bun', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
      '/usr/bin/codex',
    ];
    for (const candidate of candidates) {
      if (await isExecutable(candidate)) {
        result = candidate;
        break;
      }
    }
    codexCache.set(key, result);
    return result;
  };
  const sseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...CORS_HEADERS,
  };

  type CodexConfig = {
    model: string;
    reasoningEffort: string;
    sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
    profile?: string;
    codexPath: string;
    approveForMe: boolean;
    skipGitRepoCheck: boolean;
    config: Record<string, string | number | boolean | string[]>;
  };

  const loadCodexConfig = async (): Promise<CodexConfig> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === 'ENOENT') {
        throw new Error(`Codex server config not found: ${path.relative(root, configPath)}`);
      }
      throw new Error(`Could not read Codex server config: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Codex server config must be a JSON object');
    }
    const value = parsed as Record<string, unknown>;
    const sandbox = value.sandbox;
    if (sandbox !== 'read-only' && sandbox !== 'workspace-write' && sandbox !== 'danger-full-access') {
      throw new Error('Codex server config `sandbox` must be read-only, workspace-write, or danger-full-access');
    }
    const extra = value.config;
    const config: CodexConfig['config'] = {};
    if (extra !== undefined) {
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
        throw new Error('Codex server config `config` must be an object');
      }
      for (const [key, item] of Object.entries(extra)) {
        if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(key)) {
          throw new Error(`Invalid Codex config key: ${key}`);
        }
        if (
          typeof item !== 'string' &&
          typeof item !== 'number' &&
          typeof item !== 'boolean' &&
          !(Array.isArray(item) && item.every((entry) => typeof entry === 'string'))
        ) {
          throw new Error(`Unsupported value for Codex config key: ${key}`);
        }
        config[key] = item;
      }
    }
    return {
      model: typeof value.model === 'string' ? value.model.trim() : '',
      reasoningEffort: typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : '',
      sandbox,
      profile: typeof value.profile === 'string' && value.profile.trim() ? value.profile.trim() : undefined,
      codexPath: typeof value.codexPath === 'string' && value.codexPath.trim() ? value.codexPath.trim() : 'codex',
      approveForMe: value.approveForMe === true,
      skipGitRepoCheck: value.skipGitRepoCheck === true,
      config,
    };
  };

  type StoredSession = {
    id: string;
    threadId: string | null;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: unknown[];
  };

  const readSessions = async (): Promise<StoredSession[]> => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(sessionStorePath, 'utf8'));
      return Array.isArray(parsed) ? (parsed as StoredSession[]) : [];
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === 'ENOENT') return [];
      throw error;
    }
  };

  const writeSessions = async (sessions: StoredSession[]): Promise<void> => {
    await fs.mkdir(path.dirname(sessionStorePath), { recursive: true });
    const tempPath = `${sessionStorePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(sessions, null, 2), 'utf8');
    await fs.rename(tempPath, sessionStorePath);
  };

  const upsertSession = async (session: StoredSession): Promise<void> => {
    const write = sessionWriteChain.then(async () => {
      const sessions = await readSessions();
      await writeSessions([...sessions.filter((item) => item.id !== session.id), session]);
    });
    sessionWriteChain = write.catch(() => undefined);
    await write;
  };

  const configLiteral = (value: string | number | boolean | string[]): string => {
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(',')}]`;
    return String(value);
  };

  const writeEvent = (res: import('node:http').ServerResponse, payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  /** Streams a child process's line-based stdout/stderr as SSE events. */
  const streamProcess = (
    res: import('node:http').ServerResponse,
    child: ChildProcessWithoutNullStreams,
    mapEvent: (event: Record<string, unknown>) => unknown,
  ) => {
    const buffers = { stdout: '', stderr: '' };
    const flush = (key: 'stdout' | 'stderr') => {
      const lines = buffers[key].split('\n');
      buffers[key] = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        if (key === 'stdout') {
          let parsed: unknown = line;
          try {
            parsed = JSON.parse(line);
          } catch {
            // raw (non-JSON) stdout line
          }
          if (typeof parsed === 'object' && parsed !== null) {
            writeEvent(res, { type: 'codex', event: mapEvent(parsed as Record<string, unknown>) });
          } else {
            writeEvent(res, { type: 'stdout', text: line });
          }
        } else {
          writeEvent(res, { type: 'stderr', text: line });
        }
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      buffers.stdout += chunk.toString();
      flush('stdout');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      buffers.stderr += chunk.toString();
      flush('stderr');
    });
    child.on('exit', (code) => {
      flush('stdout');
      flush('stderr');
      writeEvent(res, { type: 'exit', code: code ?? null });
      res.end();
    });
    child.on('error', (error) => {
      writeEvent(res, { type: 'exit', code: null, error: error.message });
      res.end();
    });
    res.on('close', () => {
      child.kill('SIGTERM');
    });
  };

  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'storybook-addon-llm',
        root,
        port: basePort,
        capabilities: ['files', 'codex-config', 'codex-models', 'codex-sessions'],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/codex/status') {
      let serverConfig: CodexConfig;
      try {
        serverConfig = await loadCodexConfig();
      } catch (error) {
        sendJson(res, 200, { ok: false, configured: false, path: configPath, error: (error as Error).message });
        return;
      }
      const preferred = serverConfig.codexPath;
      const resolved = await resolveCodex(preferred);
      if (!resolved) {
        sendJson(res, 200, {
          ok: false,
          error: 'codex binary not found on PATH or in common install locations — set the full path in Settings',
        });
        return;
      }
      if (codexVersion === null) {
        codexVersion = await new Promise<string | null>((resolve) => {
          const child = spawn(resolved, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let output = '';
          child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
          });
          child.stderr.on('data', (chunk: Buffer) => {
            output += chunk.toString();
          });
          child.on('error', () => resolve(null));
          child.on('exit', () => resolve(output.trim() || null));
          setTimeout(() => resolve(null), 5000);
        });
      }
      if (!codexVersion) {
        sendJson(res, 200, { ok: false, path: resolved, error: 'codex binary found but not executable' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        configured: true,
        version: codexVersion,
        path: resolved,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/codex/config') {
      try {
        const config = await loadCodexConfig();
        sendJson(res, 200, { ok: true, configured: true, path: configPath, config });
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          configured: false,
          path: configPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/codex/models') {
      const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
      try {
        const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Record<string, unknown>;
        const models = Array.isArray(cache.models)
          ? cache.models
              .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
              .filter((item) => item.visibility !== 'hide')
              .map((item) => ({
                id: String(item.slug ?? ''),
                name: String(item.display_name ?? item.slug ?? ''),
                description: typeof item.description === 'string' ? item.description : '',
                defaultReasoningEffort:
                  typeof item.default_reasoning_level === 'string' ? item.default_reasoning_level : '',
                reasoningEfforts: Array.isArray(item.supported_reasoning_levels)
                  ? item.supported_reasoning_levels
                      .filter((level): level is Record<string, unknown> => !!level && typeof level === 'object')
                      .map((level) => ({
                        id: String(level.effort ?? ''),
                        description: typeof level.description === 'string' ? level.description : '',
                      }))
                      .filter((level) => level.id)
                  : [],
              }))
              .filter((item) => item.id)
          : [];
        sendJson(res, 200, {
          models,
          fetchedAt: typeof cache.fetched_at === 'string' ? cache.fetched_at : null,
          source: cachePath,
        });
      } catch (error) {
        sendJson(res, 200, {
          models: [],
          fetchedAt: null,
          source: cachePath,
          error: `Codex model catalog is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/codex/sessions') {
      const sessions = (await readSessions())
        .map(({ messages, ...session }) => ({ ...session, messageCount: messages.length }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      sendJson(res, 200, { sessions });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/codex/sessions/')) {
      const id = decodeURIComponent(url.pathname.slice('/codex/sessions/'.length));
      const session = (await readSessions()).find((item) => item.id === id);
      if (!session) {
        sendJson(res, 404, { error: 'Session not found' });
      } else {
        sendJson(res, 200, session);
      }
      return;
    }

    if (req.method !== 'POST' && req.method !== 'PUT') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) ?? {};
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/codex/sessions/')) {
      const id = decodeURIComponent(url.pathname.slice('/codex/sessions/'.length));
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return;
      }
      if (!Array.isArray(body.messages)) {
        sendJson(res, 400, { error: '`messages` must be an array' });
        return;
      }
      const now = Date.now();
      const previous = (await readSessions()).find((item) => item.id === id);
      const session: StoredSession = {
        id,
        threadId: typeof body.threadId === 'string' && body.threadId ? body.threadId : null,
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'New session',
        createdAt: typeof body.createdAt === 'number' ? body.createdAt : (previous?.createdAt ?? now),
        updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : now,
        messages: body.messages,
      };
      await upsertSession(session);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/codex/config') {
      if (body.sandbox !== 'read-only' && body.sandbox !== 'workspace-write' && body.sandbox !== 'danger-full-access') {
        sendJson(res, 400, { ok: false, error: 'Invalid sandbox mode' });
        return;
      }
      const nextConfig = {
        model: typeof body.model === 'string' ? body.model : '',
        reasoningEffort: typeof body.reasoningEffort === 'string' ? body.reasoningEffort : '',
        sandbox: body.sandbox,
        profile: typeof body.profile === 'string' ? body.profile : '',
        codexPath: typeof body.codexPath === 'string' ? body.codexPath : 'codex',
        approveForMe: body.approveForMe === true,
        skipGitRepoCheck: body.skipGitRepoCheck === true,
        config: body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : {},
      };
      try {
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        const tempPath = `${configPath}.${process.pid}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(nextConfig, null, 2) + '\n', 'utf8');
        await fs.rename(tempPath, configPath);
        const config = await loadCodexConfig();
        sendJson(res, 200, { ok: true, configured: true, path: configPath, config });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === '/codex/run') {
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (!prompt.trim()) {
        sendJson(res, 400, { ok: false, error: '`prompt` is required' });
        return;
      }
      let serverConfig: CodexConfig;
      try {
        serverConfig = await loadCodexConfig();
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const resolvedCodex = await resolveCodex(serverConfig.codexPath);
      if (!resolvedCodex) {
        sendJson(res, 400, {
          ok: false,
          error: `codex binary not found; configure codexPath in ${path.relative(root, configPath)}`,
        });
        return;
      }
      const { sandbox, model, reasoningEffort, approveForMe, skipGitRepoCheck } = serverConfig;
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      // --approve-for-me implies the workspace-write sandbox; codex rejects the
      // combination with an explicit --sandbox flag.
      const explicitSandbox = sandbox === 'read-only' || sandbox === 'danger-full-access';

      const args = ['exec'];
      if (serverConfig.profile) args.push('--profile', serverConfig.profile);
      for (const [key, value] of Object.entries(serverConfig.config)) {
        args.push('--config', `${key}=${configLiteral(value)}`);
      }
      if (reasoningEffort) args.push('--config', `model_reasoning_effort=${configLiteral(reasoningEffort)}`);
      if (sessionId) {
        // The resume subcommand supports a smaller flag set: sandbox, -C and
        // approvals are inherited from the original session.
        args.push('resume', sessionId);
        args.push('--json');
        if (model) {
          args.push('--model', model);
        }
        if (skipGitRepoCheck) {
          args.push('--skip-git-repo-check');
        }
        args.push('--', prompt);
      } else {
        args.push('--json', '--color', 'never');
        if (explicitSandbox) {
          args.push('--sandbox', sandbox);
        }
        if (approveForMe && sandbox === 'workspace-write') {
          args.push('--approve-for-me');
        }
        if (skipGitRepoCheck) {
          args.push('--skip-git-repo-check');
        }
        if (model) {
          args.push('--model', model);
        }
        args.push('-C', root);
        args.push('--', prompt);
      }

      res.writeHead(200, sseHeaders);

      const child = spawn(resolvedCodex, args, {
        cwd: root,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      streamProcess(res, child, (event) => event);
      return;
    }

    const rawPath = typeof body.path === 'string' ? body.path : '';
    const target = resolveProjectPath(root, rawPath);
    if (!target) {
      sendJson(res, 400, { ok: false, error: 'Path is outside the project root' });
      return;
    }

    try {
      switch (url.pathname) {
        case '/file/list': {
          const entries = await fs.readdir(target, { withFileTypes: true });
          sendJson(res, 200, {
            ok: true,
            path: target,
            entries: entries
              .filter((entry) => !entry.name.startsWith('.'))
              .map((entry) => ({
                name: entry.name,
                type: entry.isDirectory() ? 'dir' : 'file',
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          });
          return;
        }
        case '/file/read': {
          const content = await fs.readFile(target, 'utf8');
          sendJson(res, 200, { ok: true, path: target, content });
          return;
        }
        case '/file/write': {
          if (typeof body.content !== 'string') {
            sendJson(res, 400, { ok: false, error: '`content` string is required' });
            return;
          }
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, body.content, 'utf8');
          sendJson(res, 200, { ok: true, path: target, written: Buffer.byteLength(body.content) });
          return;
        }
        default:
          sendJson(res, 404, { ok: false, error: `Unknown endpoint: ${url.pathname}` });
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
      sendJson(res, code === 'ENOENT' ? 404 : 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = basePort + attempt;
    try {
      const server = createServer(handler);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });

      console.log(`[storybook-addon-llm] file server listening on http://127.0.0.1:${port} (root: ${root})`);
      return { port, root, server };
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        continue;
      }

      console.warn(
        `[storybook-addon-llm] could not start file server: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  console.warn('[storybook-addon-llm] file server disabled: no free port found');
  return null;
}

let startPromise: Promise<FileServerState | null> | null = null;

function startOnce(options: FileServerOptions): Promise<FileServerState | null> {
  if (!startPromise) {
    startPromise = createFileServer(options);
  }
  return startPromise;
}

/** Preset hook: starts the local file server when the addon is loaded. */
export function managerEntries(entry: unknown[] = [], options: FileServerOptions = {}): unknown[] {
  if (options.fileTools !== false) {
    void startOnce(options);
  }
  return entry;
}
