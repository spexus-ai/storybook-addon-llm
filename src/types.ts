export interface ElementSnapshot {
  id: string;
  capturedAt: number;
  tagName: string;
  attributes: Record<string, string>;
  outerHTML: string;
  innerText: string;
  computedStyles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  accessibility: Record<string, string | null>;
  screenshot?: string;
  screenshotError?: string;
}

export interface LLMSettings {
  baseURL: string;
  apiKey: string;
  model: string;
  sendScreenshots: boolean;
  systemPrompt: string;
  fileTools: boolean;
  fileServerPort: number;
  mcpBridge: boolean;
  mcpUrl: string;
  /** 'api' = OpenAI-compatible HTTP API, 'codex' = local Codex CLI binary. */
  provider: 'api' | 'codex';
}

export type MessagePart = { id: string; type: 'text'; content: string } | { id: string; type: 'tool'; tool: ToolEvent };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ElementSnapshot[];
  error?: string;
  tools?: ToolEvent[];
  /** Ordered response timeline. Used by agent providers whose tool calls and text interleave. */
  parts?: MessagePart[];
}

export interface ChatSession {
  id: string;
  threadId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export type ChatSessionSummary = Omit<ChatSession, 'messages'> & { messageCount: number };

export interface CodexServerConfig {
  model: string;
  reasoningEffort: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  profile?: string;
  codexPath: string;
  approveForMe: boolean;
  skipGitRepoCheck: boolean;
  config: Record<string, string | number | boolean | string[]>;
}

export interface ToolEvent {
  id: string;
  name: string;
  detail: string;
  ok: boolean;
}

export interface LLMContentPartText {
  type: 'text';
  text: string;
}

export interface LLMContentPartImage {
  type: 'image_url';
  image_url: { url: string };
}

export type LLMContentPart = LLMContentPartText | LLMContentPartImage;

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMCallMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LLMContentPart[];
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
}

export interface StoryContextData {
  id: string;
  title: string;
  name: string;
  args?: Record<string, unknown>;
  argTypes?: Record<string, unknown>;
  source?: string;
  /** Story file path relative to the project root (when the file server is reachable). */
  importPath?: string;
  /** Absolute story file path (useful for MCP tools like get-stories-by-component). */
  absoluteImportPath?: string;
  /** URL of the currently open story. */
  previewUrl?: string;
}
