import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface FileServerOptions {
  /** Enable the project file tools. Default: true. */
  fileTools?: boolean;
  /** Base port for the local file server. Default: 6050. */
  fileServerPort?: number;
  /** Project root for file access. Default: process.cwd(). */
  fileRoot?: string;
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
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

  let codexVersion: string | null = null;

  const sseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...CORS_HEADERS,
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
      sendJson(res, 200, { ok: true, root, port: basePort });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/codex/status') {
      if (codexVersion === null) {
        codexVersion = await new Promise<string | null>((resolve) => {
          const child = spawn('codex', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (codexVersion) {
        sendJson(res, 200, { ok: true, version: codexVersion });
      } else {
        sendJson(res, 200, { ok: false, error: 'codex binary not found on PATH' });
      }
      return;
    }

    if (req.method !== 'POST') {
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

    if (url.pathname === '/codex/run') {
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (!prompt.trim()) {
        sendJson(res, 400, { ok: false, error: '`prompt` is required' });
        return;
      }
      const codexPath = typeof body.codexPath === 'string' && body.codexPath.trim() ? body.codexPath.trim() : 'codex';
      const sandbox =
        body.sandbox === 'read-only' || body.sandbox === 'workspace-write' || body.sandbox === 'danger-full-access'
          ? body.sandbox
          : 'workspace-write';
      const model = typeof body.model === 'string' ? body.model.trim() : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      const skipGitCheck = body.skipGitCheck === true;
      // --approve-for-me implies the workspace-write sandbox; codex rejects the
      // combination with an explicit --sandbox flag.
      const approveForMe = body.approveForMe === true && sandbox === 'workspace-write';
      const explicitSandbox = sandbox === 'read-only' || sandbox === 'danger-full-access';
      const keepSession = body.keepSession === true;

      const args = ['exec'];
      if (sessionId) {
        // The resume subcommand supports a smaller flag set: sandbox, -C and
        // approvals are inherited from the original session.
        args.push('resume', sessionId);
        args.push('--json');
        if (model) {
          args.push('--model', model);
        }
        if (skipGitCheck) {
          args.push('--skip-git-repo-check');
        }
        args.push('--', prompt);
      } else {
        args.push('--json', '--color', 'never');
        if (!keepSession) {
          args.push('--ephemeral');
        }
        if (explicitSandbox) {
          args.push('--sandbox', sandbox);
        }
        if (approveForMe) {
          args.push('--approve-for-me');
        }
        if (skipGitCheck) {
          args.push('--skip-git-repo-check');
        }
        if (model) {
          args.push('--model', model);
        }
        args.push('-C', root);
        args.push('--', prompt);
      }

      res.writeHead(200, sseHeaders);

      const child = spawn(codexPath, args, {
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
