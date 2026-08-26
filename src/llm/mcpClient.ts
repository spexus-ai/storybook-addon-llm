export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

function parseSSEPayloads(text: string): string[] {
  const payloads: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (trimmed.startsWith('data:')) {
      payloads.push(trimmed.slice(5).trim());
    }
  }
  return payloads;
}

/**
 * Minimal MCP client for the Storybook MCP server (`@storybook/addon-mcp`),
 * which is served by the Storybook dev server at `/<mcp>`.
 * Speaks the streamable-HTTP transport: JSON-RPC over POST, SSE responses.
 */
export class MCPClient {
  private sessionId: string | null = null;
  private requestId = 1;

  constructor(private readonly endpoint: string) {}

  private async request(method: string, params?: Record<string, unknown>): Promise<JSONRPCResponse> {
    const id = this.requestId;
    this.requestId += 1;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed with status ${response.status}`);
    }

    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) {
      this.sessionId = sessionId;
    }

    const contentType = response.headers.get('content-type') ?? '';
    let body: string;
    if (contentType.includes('text/event-stream') && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
      body = text;
    } else {
      body = await response.text();
    }

    const candidates: JSONRPCResponse[] = [];
    if (contentType.includes('text/event-stream')) {
      for (const payload of parseSSEPayloads(body)) {
        try {
          const parsed = JSON.parse(payload) as JSONRPCResponse;
          if (parsed.id === id) {
            candidates.push(parsed);
          }
        } catch {
          // ignore keep-alives and malformed events
        }
      }
    } else {
      try {
        const parsed = JSON.parse(body) as JSONRPCResponse;
        if (parsed.id === id) {
          candidates.push(parsed);
        }
      } catch {
        // fall through
      }
    }

    const responseMessage = candidates[candidates.length - 1];
    if (!responseMessage) {
      throw new Error(`MCP: no response for ${method}`);
    }
    return responseMessage;
  }

  async initialize(): Promise<void> {
    const response = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'storybook-addon-llm', version: '0.1.0' },
    });
    if (response.error) {
      throw new Error(`MCP initialize failed: ${response.error.message}`);
    }
    // Fire-and-forget: send the initialized notification.
    void fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }),
    }).catch(() => undefined);
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this.request('tools/list');
    if (response.error) {
      throw new Error(`MCP tools/list failed: ${response.error.message}`);
    }
    const tools = (response.result as { tools?: unknown })?.tools;
    if (!Array.isArray(tools)) {
      return [];
    }
    return tools
      .filter((tool): tool is Record<string, unknown> => typeof tool === 'object' && tool !== null)
      .map((tool) => ({
        name: String(tool.name ?? ''),
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema:
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? (tool.inputSchema as Record<string, unknown>)
            : undefined,
      }))
      .filter((tool) => tool.name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.request('tools/call', { name, arguments: args });
    if (response.error) {
      throw new Error(`MCP tool ${name} failed: ${response.error.message}`);
    }
    const result = response.result as { content?: unknown; isError?: boolean };
    const content = Array.isArray(result?.content)
      ? result.content
          .filter((part): part is { text?: string; type?: string } => typeof part === 'object' && part !== null)
          .map((part) => part.text ?? '')
          .join('\n')
      : typeof result?.content === 'string'
        ? result.content
        : JSON.stringify(result ?? {});
    return result?.isError ? `Error: ${content}` : content;
  }
}

/** Resolves the MCP endpoint: explicit URL or the current origin's /mcp. */
export function resolveMcpUrl(explicit: string): string {
  const trimmed = explicit.trim();
  if (trimmed) {
    return trimmed;
  }
  return `${window.location.origin}/mcp`;
}
