import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AddonPanel } from 'storybook/internal/components';
import { useGlobals, useStorybookApi } from 'storybook/manager-api';

import { KEY } from '../constants';
import { isImageUnsupportedError, LLMError, streamChatCompletionFull } from '../llm/client';
import { runCodex, summarizeItem, type CodexHandlers } from '../llm/codexClient';
import { buildCodexPrompt, buildMessages } from '../llm/context';
import { findFileServer } from '../llm/fileTools';
import { MCPClient, resolveMcpUrl, type MCPTool } from '../llm/mcpClient';
import { loadSettings, saveSettings } from '../llm/storage';
import { FILE_TOOL_DEFINITIONS, TOOL_DEFINITIONS } from '../llm/tools';
import { executeToolCall } from '../toolExecutor';
import type { ChatMessage, LLMSettings, StoryContextData, ToolEvent } from '../types';
import type { ToolDefinition } from '../llm/tools';
import { uid } from '../utils';
import { attachmentStore } from './attachmentStore';
import { ChatInput } from './ChatInput';
import { ContextChips } from './ContextChips';
import { Message } from './Message';
import { SettingsModal } from './SettingsModal';

interface PanelProps {
  active: boolean;
}

type StoryData = ReturnType<ReturnType<typeof useStorybookApi>['getCurrentStoryData']>;

function toRelativePath(root: string, path: string): string {
  const normalizedRoot = root.replace(/\/+$/, '');
  if (path === normalizedRoot) {
    return '.';
  }
  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }
  // Storybook may already return a project-relative path like "./src/…"
  return path.startsWith('./') ? path.slice(2) : path;
}

function extractStory(story: StoryData | undefined, fileServerRoot: string | null): StoryContextData | undefined {
  if (!story || story.type !== 'story') {
    return undefined;
  }
  const parameters = (story.parameters ?? {}) as Record<string, unknown>;
  const storySource = parameters.storySource as Record<string, unknown> | undefined;
  const docs = parameters.docs as Record<string, unknown> | undefined;
  const docsSource = docs?.source as Record<string, unknown> | undefined;
  const source = storySource?.source ?? docsSource?.code;
  const absoluteImportPath = typeof story.importPath === 'string' ? story.importPath : undefined;

  return {
    id: story.id,
    title: story.title,
    name: story.name,
    args: story.args as Record<string, unknown> | undefined,
    argTypes: story.argTypes as Record<string, unknown> | undefined,
    source: typeof source === 'string' ? source : undefined,
    importPath:
      absoluteImportPath && fileServerRoot ? toRelativePath(fileServerRoot, absoluteImportPath) : absoluteImportPath,
    absoluteImportPath,
    previewUrl: window.location.href,
  };
}

export const Panel: React.FC<PanelProps> = ({ active }) => {
  const api = useStorybookApi();
  const [globals, updateGlobals] = useGlobals();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<LLMSettings>(() => loadSettings());
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [mcpStatus, setMcpStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [fileServerUrl, setFileServerUrl] = useState<string | null>(null);
  const [fileServerRoot, setFileServerRoot] = useState<string | null>(null);
  const [codexThreadId, setCodexThreadId] = useState<string | null>(null);
  const [codexStatus, setCodexStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [codexDetectedPath, setCodexDetectedPath] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const mcpClientRef = useRef<MCPClient | null>(null);

  const attachments = useSyncExternalStore(attachmentStore.subscribe, attachmentStore.getAttachments);
  const pickError = useSyncExternalStore(attachmentStore.subscribe, attachmentStore.getError);

  const story = extractStory(api.getCurrentStoryData(), fileServerRoot);
  const isPicking = globals[KEY] === true;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  // Probe the Storybook MCP server and the local file server.
  useEffect(() => {
    let cancelled = false;

    if (settings.fileTools) {
      void findFileServer(settings.fileServerPort).then(async (url) => {
        if (cancelled) {
          return;
        }
        setFileServerUrl(url);
        if (url) {
          try {
            const response = await fetch(`${url}/health`);
            const json = await response.json().catch(() => null);
            if (typeof json?.root === 'string') {
              setFileServerRoot(json.root);
              return;
            }
          } catch {
            // ignore; root stays unknown
          }
        }
        setFileServerRoot(null);
      });
    } else if (!cancelled) {
      setFileServerUrl(null);
      setFileServerRoot(null);
    }

    if (settings.mcpBridge) {
      const client = new MCPClient(resolveMcpUrl(settings.mcpUrl));
      mcpClientRef.current = client;
      void client
        .initialize()
        .then(() => client.listTools())
        .then((tools) => {
          if (cancelled) {
            return;
          }
          setMcpTools(tools);
          setMcpStatus('online');
        })
        .catch(() => {
          if (!cancelled) {
            setMcpTools([]);
            setMcpStatus('offline');
          }
        });
    } else {
      mcpClientRef.current = null;
      setMcpTools([]);
      setMcpStatus('offline');
    }

    if (settings.provider === 'codex' && settings.fileTools) {
      setCodexStatus('loading');
      void findFileServer(settings.fileServerPort).then(async (url) => {
        if (!url) {
          if (!cancelled) {
            setCodexStatus('offline');
            setCodexDetectedPath(null);
          }
          return;
        }
        try {
          const response = await fetch(`${url}/codex/status`, {
            headers: { 'x-codex-path': settings.codexPath },
          });
          const json = await response.json().catch(() => null);
          if (!cancelled) {
            setCodexStatus(json?.ok ? 'online' : 'offline');
            setCodexDetectedPath(typeof json?.path === 'string' ? json.path : null);
          }
        } catch {
          if (!cancelled) {
            setCodexStatus('offline');
            setCodexDetectedPath(null);
          }
        }
      });
    } else {
      setCodexStatus('offline');
      setCodexDetectedPath(null);
    }

    return () => {
      cancelled = true;
    };
  }, [
    settings.fileTools,
    settings.fileServerPort,
    settings.mcpBridge,
    settings.mcpUrl,
    settings.provider,
    settings.codexPath,
  ]);

  const handleSettingsChange = useCallback((next: LLMSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const togglePicking = useCallback(() => {
    updateGlobals({ [KEY]: !isPicking });
  }, [updateGlobals, isPicking]);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || streaming) {
        return;
      }
      if (settings.provider === 'api' && !settings.apiKey) {
        setSettingsOpen(true);
        return;
      }

      const nextAttachments = attachments.length ? attachments : undefined;
      const userMessage: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text,
        attachments: nextAttachments,
      };
      const history = [...messages, userMessage];
      setMessages(history);
      if (nextAttachments) {
        attachmentStore.clear();
      }

      const assistantId = uid();
      setMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const errorMessage = (error: unknown): string =>
        error instanceof LLMError || error instanceof Error ? error.message : String(error);
      const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

      const updateAssistant = (patch: Partial<ChatMessage>) =>
        setMessages((current) =>
          current.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)),
        );

      // Codex CLI provider: run `codex exec` through the addon's local server.
      if (settings.provider === 'codex') {
        try {
          if (!fileServerUrl) {
            updateAssistant({
              error:
                'The local addon server is not available — codex runs through the addon preset (check that it loaded and the port matches).',
            });
          } else {
            let accumulated = '';
            const toolEvents: ToolEvent[] = [];
            const handlers: CodexHandlers = {
              onText: (delta) => {
                accumulated += delta;
                updateAssistant({ content: accumulated });
              },
              onItem: (item) => {
                toolEvents.push({
                  id: uid(),
                  name: item.type,
                  detail: summarizeItem(item),
                  ok: item.status !== 'failed',
                });
                updateAssistant({ tools: [...toolEvents] });
              },
              onError: (message) => {
                updateAssistant({ error: message });
              },
              onThreadId: (id) => {
                setCodexThreadId(id);
              },
            };
            await runCodex(
              fileServerUrl,
              {
                prompt: buildCodexPrompt({
                  settings,
                  story,
                  userContent: text,
                  attachments: nextAttachments,
                }),
                sandbox: settings.codexSandbox,
                model: settings.codexModel,
                sessionId: settings.codexSession ? (codexThreadId ?? '') : '',
                skipGitCheck: settings.codexSkipGitCheck,
                approveForMe: settings.codexApproveForMe,
                keepSession: settings.codexSession,
                codexPath: settings.codexPath,
              },
              handlers,
              controller.signal,
            );
            if (!accumulated.trim() && !toolEvents.length) {
              updateAssistant({ error: 'codex returned no output' });
            }
          }
        } catch (error) {
          if (!isAbort(error)) {
            updateAssistant({ error: errorMessage(error) });
          }
        } finally {
          setStreaming(false);
          abortRef.current = null;
        }
        return;
      }

      let retriedWithoutImages = false;

      // The request may be retried once without image parts when the model
      // turns out to be text-only (e.g. DeepSeek).
      try {
        while (true) {
          const callSettings = retriedWithoutImages ? { ...settings, sendScreenshots: false } : settings;
          let accumulated = '';
          try {
            // The API messages list may grow with tool calls and tool results.
            const apiMessages = buildMessages({
              settings: callSettings,
              story,
              history: messages,
              userContent: text,
              attachments: nextAttachments,
            });
            let toolEvents: ToolEvent[] = [];
            let hadTools = false;

            // Merge core, file and MCP tools, keeping names unique
            // (providers reject requests with duplicate tool names).
            const seenNames = new Set<string>();
            const addTools = (tools: ToolDefinition[]) => {
              for (const tool of tools) {
                if (!seenNames.has(tool.function.name)) {
                  seenNames.add(tool.function.name);
                  merged.push(tool);
                }
              }
            };
            const merged: ToolDefinition[] = [];
            addTools(TOOL_DEFINITIONS);
            if (callSettings.fileTools) {
              addTools(FILE_TOOL_DEFINITIONS);
            }
            addTools(
              mcpTools.map((tool) => ({
                type: 'function' as const,
                function: {
                  name: tool.name,
                  description: tool.description ?? '',
                  parameters: tool.inputSchema ?? { type: 'object', properties: {} },
                },
              })),
            );
            const requestTools = merged;

            const mcpContext = mcpClientRef.current
              ? { client: mcpClientRef.current, toolNames: new Set(mcpTools.map((tool) => tool.name)) }
              : null;

            while (true) {
              const result = await streamChatCompletionFull(
                callSettings,
                apiMessages,
                requestTools,
                controller.signal,
                (delta) => {
                  accumulated += delta;
                  updateAssistant({ content: accumulated });
                },
              );
              if (!result.toolCalls.length) {
                if (!accumulated && result.content) {
                  accumulated = result.content;
                  updateAssistant({ content: accumulated });
                }
                break;
              }

              hadTools = true;
              apiMessages.push({
                role: 'assistant',
                content: result.content || '',
                tool_calls: result.toolCalls,
              });

              const events: ToolEvent[] = [];
              for (const call of result.toolCalls) {
                const execution = await executeToolCall(call, {
                  story,
                  fileServer: fileServerUrl,
                  mcp: mcpContext,
                  updateStoryArgs: (newArgs) => {
                    const currentStory = api.getCurrentStoryData();
                    if (currentStory && currentStory.type === 'story') {
                      api.updateStoryArgs(currentStory, {
                        ...(currentStory.args ?? {}),
                        ...newArgs,
                      });
                    }
                  },
                });
                events.push({
                  id: call.id,
                  name: call.function.name,
                  detail: execution.detail,
                  ok: execution.ok,
                });
                apiMessages.push({
                  role: 'tool',
                  tool_call_id: call.id,
                  content: JSON.stringify(execution.output),
                });
              }
              toolEvents = [...toolEvents, ...events];
              updateAssistant({ tools: toolEvents });
            }

            if (hadTools) {
              updateAssistant({ tools: toolEvents });
            }

            if (retriedWithoutImages) {
              accumulated = `_The model does not support images — the request was re-sent with text/HTML only._\n\n${accumulated}`;
            }
            updateAssistant({ content: accumulated });

            if (!accumulated.trim() && !hadTools) {
              updateAssistant({ error: 'The model returned an empty response.' });
            }
            break;
          } catch (error) {
            if (isAbort(error)) {
              break;
            }
            const message = errorMessage(error);
            const hadImages =
              !retriedWithoutImages &&
              callSettings.sendScreenshots &&
              (nextAttachments?.some((attachment) => attachment.screenshot) ?? false);
            if (hadImages && isImageUnsupportedError(message)) {
              retriedWithoutImages = true;
              // Persist the discovery: turn the screenshots toggle off.
              handleSettingsChange({ ...settings, sendScreenshots: false });
              updateAssistant({ content: '' });
              continue;
            }
            updateAssistant({ error: message });
            break;
          }
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      streaming,
      settings,
      messages,
      attachments,
      story,
      handleSettingsChange,
      api,
      mcpTools,
      fileServerUrl,
      codexThreadId,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    attachmentStore.clear();
    setMessages([]);
    setCodexThreadId(null);
  }, []);

  return (
    <AddonPanel key="sb-llm-panel" active={active}>
      <div className="sb-llm">
        <div className="sb-llm-header">
          <span className="sb-llm-title">LLM Chat</span>
          <span className="sb-llm-model" title={`${settings.baseURL} · ${settings.model}`}>
            {settings.provider === 'codex' ? 'codex' : settings.model || 'no model configured'}
          </span>
          {settings.provider === 'codex' && (
            <span
              className={`sb-llm-status${codexStatus === 'online' ? '' : ' sb-llm-status-off'}`}
              title={codexDetectedPath ?? 'Codex CLI binary'}
            >
              Codex: {codexStatus === 'online' ? 'ready' : codexStatus === 'loading' ? '…' : 'not found'}
            </span>
          )}
          {settings.fileTools && (
            <span
              className={`sb-llm-status${fileServerUrl ? '' : ' sb-llm-status-off'}`}
              title={
                fileServerUrl
                  ? 'Project file tools: available'
                  : 'Project file tools: unavailable (is the addon preset loaded?)'
              }
            >
              Files: {fileServerUrl ? 'on' : 'off'}
            </span>
          )}
          {settings.mcpBridge && (
            <span
              className={`sb-llm-status${mcpStatus === 'online' ? '' : ' sb-llm-status-off'}`}
              title="Storybook MCP bridge"
            >
              MCP: {mcpStatus === 'online' ? `${mcpTools.length} tools` : mcpStatus === 'loading' ? '…' : 'off'}
            </span>
          )}
          <span className="sb-llm-header-spacer" />
          <button
            type="button"
            className="sb-llm-header-btn"
            title="Configure the LLM connection"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
          <button type="button" className="sb-llm-header-btn" title="Clear the chat" onClick={clearChat}>
            Clear
          </button>
        </div>

        {pickError && (
          <div className="sb-llm-pick-error">
            <span>{pickError}</span>
            <button type="button" onClick={attachmentStore.clearError} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <ContextChips attachments={attachments} onRemove={attachmentStore.remove} onClear={attachmentStore.clear} />
        )}

        <div className="sb-llm-messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="sb-llm-empty">
              <p>
                Chat with an LLM about the current story. Pick an element of the story (the inspect button next to the
                input, or the toolbar) to attach it to your next message.
              </p>
              <p>
                <button type="button" className="sb-llm-link" onClick={() => setSettingsOpen(true)}>
                  Open settings
                </button>{' '}
                to connect your OpenAI-compatible model (DeepSeek, OpenAI, Ollama, …).
              </p>
            </div>
          )}
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
        </div>

        <ChatInput
          streaming={streaming}
          picking={isPicking}
          onTogglePicking={togglePicking}
          onSend={(text) => void send(text)}
          onStop={stop}
        />

        {settingsOpen && (
          <SettingsModal
            settings={settings}
            codexDetectedPath={codexDetectedPath}
            onChange={handleSettingsChange}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </AddonPanel>
  );
};
