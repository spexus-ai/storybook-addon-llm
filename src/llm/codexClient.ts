import { parseSSE } from './client';

export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexRunParams {
  prompt: string;
  sandbox: CodexSandbox;
  model: string;
  sessionId: string;
  skipGitCheck: boolean;
  approveForMe: boolean;
  keepSession: boolean;
  codexPath: string;
}

export interface CodexItem {
  type: string;
  command?: string;
  file?: string;
  status?: string;
  title?: string;
}

export interface CodexHandlers {
  onText: (text: string) => void;
  onItem: (item: CodexItem) => void;
  onError: (message: string) => void;
  onThreadId: (id: string) => void;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
    file?: string;
    status?: string;
    title?: string;
  };
  message?: string;
  error?: { message?: string } | string;
}

function summarizeItem(item: CodexItem): string {
  switch (item.type) {
    case 'command_execution':
      return item.command ?? 'command executed';
    case 'file_change':
      return item.file ?? 'file changed';
    case 'mcp_tool_call':
      return item.title ?? 'MCP tool call';
    case 'web_search':
      return item.title ?? 'web search';
    default:
      return item.title ?? item.type;
  }
}

/**
 * Runs `codex exec` through the addon's local file server and streams the
 * JSONL events back (SSE from the server, parsed here).
 */
export async function runCodex(
  serverUrl: string,
  params: CodexRunParams,
  handlers: CodexHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${serverUrl}/codex/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `codex run failed with status ${response.status}`;
    try {
      const json = await response.json();
      if (typeof json?.error === 'string') {
        message = json.error;
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawAgentMessage = false;
  let sawItem = false;
  const stderrLines: string[] = [];

  const consume = (events: string[]) => {
    for (const event of events) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event) as Record<string, unknown>;
      } catch {
        continue;
      }
      switch (payload.type) {
        case 'codex': {
          const codexEvent = (payload.event ?? {}) as CodexEvent;
          switch (codexEvent.type) {
            case 'thread.started':
              if (typeof codexEvent.thread_id === 'string') {
                handlers.onThreadId(codexEvent.thread_id);
              }
              break;
            case 'item.completed':
            case 'item.started': {
              const item = codexEvent.item;
              if (!item) {
                break;
              }
              const itemType = item.type ?? '';
              if (codexEvent.type === 'item.completed' && itemType === 'agent_message') {
                if (typeof item.text === 'string' && item.text) {
                  sawAgentMessage = true;
                  handlers.onText(item.text);
                }
              } else if (
                itemType === 'command_execution' ||
                itemType === 'file_change' ||
                itemType === 'mcp_tool_call' ||
                itemType === 'web_search'
              ) {
                sawItem = true;
                handlers.onItem({
                  type: itemType,
                  command: item.command,
                  file: item.file,
                  status: item.status,
                  title: item.title,
                });
              }
              break;
            }
            case 'turn.failed':
            case 'error': {
              const detail = codexEvent.error;
              const message =
                typeof detail === 'string'
                  ? detail
                  : detail && typeof detail.message === 'string'
                    ? detail.message
                    : (codexEvent.message ?? 'codex failed');
              handlers.onError(message);
              break;
            }
            default:
              break;
          }
          break;
        }
        case 'exit': {
          const code = payload.code;
          const error = typeof payload.error === 'string' ? payload.error : null;
          if (error) {
            handlers.onError(error);
          } else if (code !== null && code !== 0) {
            handlers.onError(
              stderrLines.length
                ? stderrLines.join('\n')
                : sawAgentMessage || sawItem
                  ? `codex exited with code ${code}`
                  : `codex exited with code ${code} and produced no output`,
            );
          }
          break;
        }
        case 'stderr': {
          if (typeof payload.text === 'string' && payload.text.trim()) {
            stderrLines.push(payload.text.trim());
            if (stderrLines.length > 8) {
              stderrLines.shift();
            }
          }
          break;
        }
        default:
          break;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSE(buffer);
    buffer = rest;
    consume(events);
  }
  if (buffer) {
    consume(parseSSE(`${buffer}\n`).events);
  }
}

export { summarizeItem };
