import React, { useEffect, useMemo, useState } from 'react';

import { testConnection, type ConnectionTestResult } from '../llm/client';
import { getCodexModels, saveCodexConfig, type CodexConfigResponse, type CodexModelInfo } from '../llm/codexClient';
import type { CodexServerConfig, LLMSettings } from '../types';

interface SettingsModalProps {
  settings: LLMSettings;
  onChange: (settings: LLMSettings) => void;
  onClose: () => void;
  codexDetectedPath?: string | null;
  codexConfig: CodexConfigResponse | null;
  fileServerUrl: string | null;
  onCodexConfigChange: (config: CodexConfigResponse) => void;
  onResumeThread: (threadId: string) => void;
}

const PRESETS: Array<{ name: string; baseURL: string; model: string }> = [
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'Custom', baseURL: '', model: '' },
];

const DEFAULT_CODEX_CONFIG: CodexServerConfig = {
  model: '',
  reasoningEffort: '',
  sandbox: 'workspace-write',
  codexPath: 'codex',
  approveForMe: true,
  skipGitRepoCheck: false,
  config: {},
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onChange,
  onClose,
  codexDetectedPath,
  codexConfig,
  fileServerUrl,
  onCodexConfigChange,
  onResumeThread,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [codexDraft, setCodexDraft] = useState<CodexServerConfig>(() => codexConfig?.config ?? DEFAULT_CODEX_CONFIG);
  const [codexModels, setCodexModels] = useState<CodexModelInfo[]>([]);
  const [savingCodex, setSavingCodex] = useState(false);
  const [codexResult, setCodexResult] = useState<ConnectionTestResult | null>(null);
  const [resumeThreadId, setResumeThreadId] = useState('');

  useEffect(() => {
    if (codexConfig?.config) setCodexDraft(codexConfig.config);
  }, [codexConfig]);

  useEffect(() => {
    if (!fileServerUrl || settings.provider !== 'codex') return;
    void getCodexModels(fileServerUrl)
      .then((result) => setCodexModels(result.models))
      .catch(() => setCodexModels([]));
  }, [fileServerUrl, settings.provider]);

  const selectedCodexModel = useMemo(
    () => codexModels.find((model) => model.id === codexDraft.model),
    [codexDraft.model, codexModels],
  );

  const setCodex = <K extends keyof CodexServerConfig>(key: K, value: CodexServerConfig[K]) => {
    setCodexDraft((current) => ({ ...current, [key]: value }));
  };

  const persistCodexConfig = async () => {
    if (!fileServerUrl) return;
    setSavingCodex(true);
    setCodexResult(null);
    try {
      const result = await saveCodexConfig(fileServerUrl, codexDraft);
      onCodexConfigChange(result);
      setCodexResult({ ok: true, message: `Saved to ${result.path}` });
    } catch (error) {
      setCodexResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSavingCodex(false);
    }
  };

  const set = <K extends keyof LLMSettings>(key: K, value: LLMSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection(settings));
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="sb-llm-modal-overlay" onClick={onClose}>
      <div className="sb-llm-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="sb-llm-modal-title">Harness settings</h3>

        <div className="sb-llm-modal-field">
          <span className="sb-llm-modal-label">Provider</span>
          <div className="sb-llm-presets">
            <button
              type="button"
              className={`sb-llm-header-btn${settings.provider === 'api' ? ' sb-llm-header-btn-active' : ''}`}
              onClick={() => onChange({ ...settings, provider: 'api' })}
            >
              OpenAI-compatible API
            </button>
            <button
              type="button"
              className={`sb-llm-header-btn${settings.provider === 'codex' ? ' sb-llm-header-btn-active' : ''}`}
              onClick={() => onChange({ ...settings, provider: 'codex', fileTools: true })}
            >
              Codex CLI
            </button>
          </div>
        </div>

        {settings.provider === 'api' && (
          <div className="sb-llm-provider-section">
            <div className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Provider preset</span>
              <div className="sb-llm-presets">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="sb-llm-header-btn"
                    onClick={() => onChange({ ...settings, baseURL: preset.baseURL, model: preset.model })}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Base URL (OpenAI-compatible)</span>
              <input
                type="text"
                value={settings.baseURL}
                onChange={(event) => set('baseURL', event.target.value)}
                placeholder="https://api.deepseek.com"
              />
            </label>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">API key</span>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(event) => set('apiKey', event.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Model</span>
              <input
                type="text"
                value={settings.model}
                onChange={(event) => set('model', event.target.value)}
                placeholder="deepseek-chat"
              />
            </label>

            <label className="sb-llm-modal-field sb-llm-modal-checkbox">
              <input
                type="checkbox"
                checked={settings.sendScreenshots}
                onChange={(event) => set('sendScreenshots', event.target.checked)}
              />
              <span>
                Send element screenshots to the model. Requires a vision-capable model — disable for text-only models
                (e.g. DeepSeek, Ollama llama3).
              </span>
            </label>
          </div>
        )}

        {settings.provider === 'codex' && (
          <div className="sb-llm-provider-section">
            <div className="sb-llm-config-card">
              <div>
                <strong>Server configuration</strong>
                <div className="sb-llm-modal-hint">{codexConfig?.path ?? '.storybook/codex.config.json'}</div>
              </div>
              <span className={`sb-llm-config-badge${codexConfig?.configured ? '' : ' sb-llm-config-badge-warn'}`}>
                {codexConfig?.configured ? 'Configured' : 'Setup required'}
              </span>
            </div>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Model</span>
              <select
                value={codexDraft.model}
                onChange={(event) => {
                  const model = codexModels.find((item) => item.id === event.target.value);
                  setCodexDraft((current) => ({
                    ...current,
                    model: event.target.value,
                    reasoningEffort: model?.defaultReasoningEffort ?? '',
                  }));
                }}
              >
                <option value="">Codex default</option>
                {codexModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
                {codexDraft.model && !codexModels.some((model) => model.id === codexDraft.model) && (
                  <option value={codexDraft.model}>{codexDraft.model}</option>
                )}
              </select>
              {selectedCodexModel?.description && (
                <span className="sb-llm-modal-hint">{selectedCodexModel.description}</span>
              )}
              {!codexModels.length && (
                <span className="sb-llm-modal-hint">The installed Codex model catalog is not available yet.</span>
              )}
            </label>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Thinking level</span>
              <select
                value={codexDraft.reasoningEffort}
                onChange={(event) => setCodex('reasoningEffort', event.target.value)}
                disabled={!selectedCodexModel?.reasoningEfforts.length}
              >
                <option value="">Model default</option>
                {selectedCodexModel?.reasoningEfforts.map((effort) => (
                  <option key={effort.id} value={effort.id}>
                    {effort.id} — {effort.description}
                  </option>
                ))}
              </select>
            </label>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Codex binary</span>
              <input
                type="text"
                value={codexDraft.codexPath}
                onChange={(event) => setCodex('codexPath', event.target.value)}
                placeholder="codex"
              />
              {codexDetectedPath && <span className="sb-llm-modal-hint">Detected: {codexDetectedPath}</span>}
            </label>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Sandbox mode</span>
              <select
                value={codexDraft.sandbox}
                onChange={(event) => setCodex('sandbox', event.target.value as CodexServerConfig['sandbox'])}
              >
                <option value="read-only">read-only (chat only)</option>
                <option value="workspace-write">workspace-write (edit project files)</option>
                <option value="danger-full-access">danger-full-access</option>
              </select>
            </label>

            <label className="sb-llm-modal-field sb-llm-modal-checkbox">
              <input
                type="checkbox"
                checked={codexDraft.approveForMe}
                onChange={(event) => setCodex('approveForMe', event.target.checked)}
              />
              <span>Auto-approve shell commands inside the workspace-write sandbox (--approve-for-me).</span>
            </label>

            <label className="sb-llm-modal-field sb-llm-modal-checkbox">
              <input
                type="checkbox"
                checked={codexDraft.skipGitRepoCheck}
                onChange={(event) => setCodex('skipGitRepoCheck', event.target.checked)}
              />
              <span>Skip the git-repository check (--skip-git-repo-check).</span>
            </label>

            <button
              type="button"
              className="sb-llm-primary-btn"
              onClick={() => void persistCodexConfig()}
              disabled={savingCodex || !fileServerUrl}
            >
              {savingCodex ? 'Saving…' : 'Save server configuration'}
            </button>
            {codexResult && (
              <div className={codexResult.ok ? 'sb-llm-test sb-llm-test-ok' : 'sb-llm-test sb-llm-test-fail'}>
                {codexResult.message}
              </div>
            )}

            <div className="sb-llm-resume-row">
              <label className="sb-llm-modal-field">
                <span className="sb-llm-modal-label">Resume Codex session by UUID or name</span>
                <input
                  type="text"
                  value={resumeThreadId}
                  onChange={(event) => setResumeThreadId(event.target.value)}
                  placeholder="019… or thread name"
                />
              </label>
              <button
                type="button"
                className="sb-llm-header-btn"
                disabled={!resumeThreadId.trim()}
                onClick={() => onResumeThread(resumeThreadId)}
              >
                Resume
              </button>
            </div>
          </div>
        )}

        {settings.provider === 'api' && <h4 className="sb-llm-modal-subtitle">Project editing</h4>}

        {settings.provider === 'api' && (
          <label className="sb-llm-modal-field sb-llm-modal-checkbox">
            <input
              type="checkbox"
              checked={settings.fileTools}
              onChange={(event) => set('fileTools', event.target.checked)}
            />
            <span>
              Allow the model to read and write project source files (permanent changes, hot-reloaded in Storybook).
              Requires the addon preset to be loaded in .storybook/main.
            </span>
          </label>
        )}

        {settings.provider === 'api' && (
          <label className="sb-llm-modal-field">
            <span className="sb-llm-modal-label">File server port</span>
            <input
              type="text"
              inputMode="numeric"
              value={String(settings.fileServerPort)}
              onChange={(event) => {
                const port = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(port)) {
                  set('fileServerPort', port);
                } else {
                  set('fileServerPort', 0);
                }
              }}
            />
          </label>
        )}

        {settings.provider === 'api' && <h4 className="sb-llm-modal-subtitle">Storybook MCP bridge</h4>}

        {settings.provider === 'api' && (
          <label className="sb-llm-modal-field sb-llm-modal-checkbox">
            <input
              type="checkbox"
              checked={settings.mcpBridge}
              onChange={(event) => set('mcpBridge', event.target.checked)}
            />
            <span>
              Expose the Storybook MCP server tools (component docs, story instructions, tests, previews) to the model.
              Requires @storybook/addon-mcp in .storybook/main and a running dev server.
            </span>
          </label>
        )}

        {settings.provider === 'api' && (
          <label className="sb-llm-modal-field">
            <span className="sb-llm-modal-label">MCP URL (empty = current origin /mcp)</span>
            <input
              type="text"
              value={settings.mcpUrl}
              onChange={(event) => set('mcpUrl', event.target.value)}
              placeholder="http://localhost:6006/mcp"
            />
          </label>
        )}

        <label className="sb-llm-modal-field">
          <span className="sb-llm-modal-label">Agent instructions</span>
          <textarea
            rows={5}
            value={settings.systemPrompt}
            onChange={(event) => set('systemPrompt', event.target.value)}
          />
        </label>

        <div className="sb-llm-modal-actions">
          {settings.provider === 'api' && (
            <button type="button" className="sb-llm-header-btn" onClick={() => void runTest()} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          )}
          <button type="button" className="sb-llm-header-btn" onClick={onClose}>
            Done
          </button>
        </div>

        {settings.provider === 'api' && testResult && (
          <div className={testResult.ok ? 'sb-llm-test sb-llm-test-ok' : 'sb-llm-test sb-llm-test-fail'}>
            {testResult.message}
          </div>
        )}

        <p className="sb-llm-modal-note">
          {settings.provider === 'api'
            ? 'The API key is stored only in this browser\u2019s localStorage and is sent exclusively to the base URL configured above.'
            : 'Codex runs locally on your machine via the addon preset and uses your existing codex authentication (~/.codex/auth.json). It works on the project directory: it can read and (in workspace-write mode) edit your files.'}
        </p>
      </div>
    </div>
  );
};
