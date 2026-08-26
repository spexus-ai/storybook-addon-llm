export interface FileServerToolResult {
  ok: boolean;
  error?: string;
}

/** Probes the local file server on the base port and the next few ports. */
export async function findFileServer(basePort: number): Promise<string | null> {
  const port = Math.max(1, Math.floor(basePort));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const origin = `http://127.0.0.1:${port + attempt}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(`${origin}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const json = await response.json().catch(() => null);
        // Verify the responder is really the addon's server, not some other
        // local service that happens to listen on the same port.
        if (json?.ok && json?.service === 'storybook-addon-llm') {
          return origin;
        }
      }
    } catch {
      // port not listening; try next
    }
  }
  return null;
}

export async function fileServerCall(
  origin: string,
  endpoint: 'list' | 'read' | 'write',
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}/file/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json && typeof json.error === 'string' ? json.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

export async function listProjectFiles(origin: string, path?: string) {
  return fileServerCall(origin, 'list', { path: path ?? '.' });
}

export async function readProjectFile(origin: string, path: string) {
  return fileServerCall(origin, 'read', { path });
}

export async function writeProjectFile(origin: string, path: string, content: string) {
  return fileServerCall(origin, 'write', { path, content });
}
