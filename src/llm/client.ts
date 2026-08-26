import type { LLMCallMessage, LLMSettings, LLMToolCall } from '../types';
import type { ToolDefinition } from './tools';

export class LLMError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
  }
}

export function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '');
}

const IMAGE_ERROR_PATTERN = /image/i;
const IMAGE_ERROR_CONTEXT = /(support|invalid|content|unsupported|type|accept|understand|capable)/i;

/**
 * Detects provider errors caused by image attachments sent to a text-only
 * model (e.g. DeepSeek: "This model does not support image").
 */
export function isImageUnsupportedError(message: string): boolean {
  return IMAGE_ERROR_PATTERN.test(message) && IMAGE_ERROR_CONTEXT.test(message);
}

/**
 * Splits a raw SSE buffer into complete `data:` events and the remainder.
 * The remainder is everything after the last `\n` (an incomplete line).
 */
export function parseSSE(buffer: string): { events: string[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('data:')) {
      continue;
    }
    events.push(line.slice(5).trim());
  }
  return { events, rest };
}

/** Extracts the content delta from a chat.completion.chunk JSON payload. */
export function parseDelta(event: string): string | null {
  return parseChunk(event).content;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export interface ParsedChunk {
  content: string | null;
  toolCalls: ToolCallDelta[];
  finishReason: string | null;
}

/**
 * Parses a chat.completion.chunk JSON payload (OpenAI-compatible streaming
 * format): content deltas, tool-call fragments and the finish reason.
 */
export function parseChunk(event: string): ParsedChunk {
  const empty: ParsedChunk = { content: null, toolCalls: [], finishReason: null };
  if (!event || event === '[DONE]') {
    return empty;
  }
  try {
    const json = JSON.parse(event);
    const choice = json?.choices?.[0];
    if (!choice) {
      return empty;
    }
    let content: string | null = null;
    const rawContent: unknown = choice?.delta?.content;
    if (typeof rawContent === 'string') {
      content = rawContent;
    } else if (Array.isArray(rawContent)) {
      const texts = rawContent
        .filter(
          (part: unknown) =>
            typeof part === 'object' && part !== null && (part as { type?: string }).type === 'output_text',
        )
        .map((part: unknown) => (part as { text?: string }).text ?? '')
        .filter(Boolean);
      if (texts.length) {
        content = texts.join('');
      }
    }
    const toolCalls: ToolCallDelta[] = Array.isArray(choice?.delta?.tool_calls)
      ? choice.delta.tool_calls
          .filter((call: unknown) => typeof call === 'object' && call !== null)
          .map((call: { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }) => ({
            index: typeof call.index === 'number' ? call.index : 0,
            id: typeof call.id === 'string' ? call.id : undefined,
            name: typeof call.function?.name === 'string' ? call.function.name : undefined,
            arguments: typeof call.function?.arguments === 'string' ? call.function.arguments : undefined,
          }))
      : [];
    const finishReason: string | null = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    return { content, toolCalls, finishReason };
  } catch {
    return empty;
  }
}

export interface StreamedCompletion {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: string | null;
}

function accumulateToolCalls(
  calls: Map<number, { id: string; name: string; arguments: string }>,
  delta: ToolCallDelta,
): void {
  const current = calls.get(delta.index) ?? { id: '', name: '', arguments: '' };
  if (delta.id) {
    current.id = delta.id;
  }
  if (delta.name) {
    current.name += delta.name;
  }
  if (delta.arguments) {
    current.arguments += delta.arguments;
  }
  calls.set(delta.index, current);
}

/**
 * Streams a chat completion from an OpenAI-compatible API and returns the
 * complete assistant message: text content plus any tool calls.
 */
export async function streamChatCompletionFull(
  settings: LLMSettings,
  messages: LLMCallMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
  onContent?: (delta: string) => void,
): Promise<StreamedCompletion> {
  const url = `${normalizeBaseURL(settings.baseURL)}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({ model: settings.model, messages, tools, stream: true }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new LLMError(await extractErrorMessage(response), response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason: string | null = null;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  const consume = (events: string[]) => {
    for (const event of events) {
      const chunk = parseChunk(event);
      if (chunk.content) {
        content += chunk.content;
        onContent?.(chunk.content);
      }
      for (const delta of chunk.toolCalls) {
        accumulateToolCalls(toolCalls, delta);
      }
      if (chunk.finishReason) {
        finishReason = chunk.finishReason;
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

  return {
    content,
    finishReason,
    toolCalls: [...toolCalls.values()].map((call) => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    })),
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/** Checks connectivity by listing available models (`GET /models`). */
export async function testConnection(settings: LLMSettings, signal?: AbortSignal): Promise<ConnectionTestResult> {
  const url = `${normalizeBaseURL(settings.baseURL)}/models`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    signal,
  });
  if (response.ok) {
    const json = await response.json().catch(() => null);
    const models: unknown = json?.data;
    if (Array.isArray(models)) {
      const ids = models
        .map((model) => (typeof model === 'object' && model !== null ? (model as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === 'string');
      const preview = ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', …' : '');
      return {
        ok: true,
        message: ids.length ? `Connected. Models: ${preview}` : 'Connected.',
      };
    }
    return { ok: true, message: 'Connected.' };
  }
  const detail = await extractErrorMessage(response);
  return { ok: false, message: detail || `HTTP ${response.status}` };
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const json = await response.json();
    const message = json?.error?.message;
    if (typeof message === 'string') {
      return message;
    }
    return JSON.stringify(json);
  } catch {
    return `Request failed with status ${response.status}`;
  }
}
