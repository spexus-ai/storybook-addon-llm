import { addons } from 'storybook/manager-api';

import { EVENTS } from './constants';
import { fileServerCall } from './llm/fileTools';
import type { MCPClient } from './llm/mcpClient';
import type { LLMToolCall, StoryContextData } from './types';
import { truncate } from './utils';

export interface ToolExecutionContext {
  story?: StoryContextData;
  updateStoryArgs: (args: Record<string, unknown>) => void;
  fileServer?: string | null;
  mcp?: { client: MCPClient; toolNames: Set<string> } | null;
}

export interface ToolExecution {
  ok: boolean;
  detail: string;
  output: Record<string, unknown>;
}

const SAFE_PROPERTY = /^[a-zA-Z-]+$/;
const MAX_DETAIL_LENGTH = 400;

function parseArguments(call: LLMToolCall): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function summary(output: Record<string, unknown>): string {
  return truncate(JSON.stringify(output), MAX_DETAIL_LENGTH);
}

export async function executeToolCall(call: LLMToolCall, context: ToolExecutionContext): Promise<ToolExecution> {
  const channel = addons.getChannel();
  const name = call.function.name;
  const args = parseArguments(call);
  if (args === null) {
    return { ok: false, detail: 'Invalid JSON in tool arguments', output: { error: 'Invalid JSON in tool arguments' } };
  }

  switch (name) {
    case 'update_story_args': {
      const newArgs = args.args;
      if (!newArgs || typeof newArgs !== 'object' || Array.isArray(newArgs)) {
        return { ok: false, detail: '`args` object is required', output: { error: '`args` object is required' } };
      }
      if (!context.story) {
        return { ok: false, detail: 'No story is currently open', output: { error: 'No story is currently open' } };
      }
      context.updateStoryArgs(newArgs as Record<string, unknown>);
      return {
        ok: true,
        detail: `Updated story args: ${JSON.stringify(newArgs)}`,
        output: { updated: newArgs },
      };
    }

    case 'apply_styles': {
      const selector = String(args.selector ?? '').trim();
      const styles = args.styles;
      if (!selector || !styles || typeof styles !== 'object' || Array.isArray(styles)) {
        return {
          ok: false,
          detail: '`selector` and `styles` are required',
          output: { error: '`selector` and `styles` are required' },
        };
      }
      const clean: Record<string, string> = {};
      for (const [property, value] of Object.entries(styles as Record<string, unknown>)) {
        if (!SAFE_PROPERTY.test(property)) {
          continue;
        }
        const str = String(value);
        if (/[;{}]/.test(str)) {
          continue;
        }
        clean[property] = str;
      }
      if (!Object.keys(clean).length) {
        return { ok: false, detail: 'No valid style declarations', output: { error: 'No valid style declarations' } };
      }
      channel.emit(EVENTS.APPLY_STYLES, { selector, styles: clean });
      return {
        ok: true,
        detail: `Applied temporary styles to ${selector}: ${JSON.stringify(clean)}`,
        output: { applied: clean, selector, temporary: true },
      };
    }

    case 'reset_styles': {
      channel.emit(EVENTS.RESET_STYLES);
      return { ok: true, detail: 'Removed all temporary style overrides', output: { reset: true } };
    }

    case 'list_project_files':
    case 'read_project_file':
    case 'write_project_file': {
      if (!context.fileServer) {
        return {
          ok: false,
          detail: 'Project file tools are unavailable — the addon preset could not start its local file server',
          output: { error: 'file server not available' },
        };
      }
      try {
        if (name === 'write_project_file') {
          const path = String(args.path ?? '');
          const content = String(args.content ?? '');
          if (!path) {
            return { ok: false, detail: '`path` is required', output: { error: '`path` is required' } };
          }
          const result = await fileServerCall(context.fileServer, 'write', { path, content });
          const absolute = typeof result.path === 'string' ? result.path : path;
          return {
            ok: true,
            detail: `Wrote ${path} (${content.length} chars)`,
            output: { written: absolute, bytes: typeof result.written === 'number' ? result.written : content.length },
          };
        }
        if (name === 'read_project_file') {
          const path = String(args.path ?? '');
          if (!path) {
            return { ok: false, detail: '`path` is required', output: { error: '`path` is required' } };
          }
          const result = await fileServerCall(context.fileServer, 'read', { path });
          const content = typeof result.content === 'string' ? result.content : '';
          return {
            ok: true,
            detail: `Read ${path} (${content.length} chars)`,
            output: { path: result.path ?? path, content: truncate(content, 50000) },
          };
        }
        const result = await fileServerCall(context.fileServer, 'list', { path: args.path ?? '.' });
        const entries = Array.isArray(result.entries) ? result.entries : [];
        const listing = entries
          .map((entry: { name?: unknown; type?: unknown }) => {
            const entryName = String(entry.name ?? '');
            return entry.type === 'dir' ? `${entryName}/` : entryName;
          })
          .join(', ');
        return {
          ok: true,
          detail: `Listed ${args.path ?? '.'}: ${truncate(listing, MAX_DETAIL_LENGTH)}`,
          output: { path: result.path ?? args.path ?? '.', entries },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, detail: `${name} failed: ${message}`, output: { error: message } };
      }
    }

    default: {
      if (context.mcp && context.mcp.toolNames.has(name)) {
        try {
          const result = await context.mcp.client.callTool(name, args);
          return {
            ok: true,
            detail: `${name}: ${truncate(result, MAX_DETAIL_LENGTH)}`,
            output: { result },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, detail: `${name} failed: ${message}`, output: { error: message } };
        }
      }
      return { ok: false, detail: `Unknown tool: ${name}`, output: { error: `Unknown tool: ${name}` } };
    }
  }
}

export { summary };
