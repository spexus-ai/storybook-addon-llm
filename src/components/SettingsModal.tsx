import React, { useState } from 'react';

import { testConnection, type ConnectionTestResult } from '../llm/client';
import type { LLMSettings } from '../types';

interface SettingsModalProps {
  settings: LLMSettings;
  onChange: (settings: LLMSettings) => void;
  onClose: () => void;
}

const PRESETS: Array<{ name: string; baseURL: string; model: string }> = [
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'Custom', baseURL: '', model: '' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onChange, onClose }) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

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
        <h3 className="sb-llm-modal-title">LLM connection</h3>

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
              onClick={() => onChange({ ...settings, provider: 'codex' })}
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
            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Codex binary path (default: codex from PATH)</span>
              <input
                type="text"
                value={settings.codexPath}
                onChange={(event) => set('codexPath', event.target.value)}
                placeholder="codex"
              />
            </label>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Sandbox mode</span>
              <select
                value={settings.codexSandbox}
                onChange={(event) =>
                  set('codexSandbox', event.target.value as 'read-only' | 'workspace-write' | 'danger-full-access')
                }
              >
                <option value="read-only">read-only (chat only)</option>
                <option value="workspace-write">workspace-write (edit project files)</option>
                <option value="danger-full-access">danger-full-access</option>
              </select>
            </label>

            <label className="sb-llm-modal-field">
              <span className="sb-llm-modal-label">Model (empty = codex default)</span>
              <input
                type="text"
                value={settings.codexModel}
                onChange={(event) => set('codexModel', event.target.value)}
                placeholder="e.g. gpt-5.2-codex"
              />
            </label>

            <label className="sb-llm-modal-field sb-llm-modal-checkbox">
              <input
                type="checkbox"
                checked={settings.codexSession}
                onChange={(event) => set('codexSession', event.target.checked)}
              />
              <span>Keep one codex session across chat messages (resume the conversation).</span>
            </label>

            <label className="sb-llm-modal-field sb-llm-modal-checkbox">
              <input
                type="checkbox"
                checked={settings.codexApproveForMe}
                onChange={(event) => set('codexApproveForMe', event.target.checked)}
              />
              <span>Auto-approve shell commands inside the workspace-write sandbox (--approve-for-me).</span>
            </label>

            <label className="sb-llm-modal-field sb-llm-modal-checkbox">
              <input
                type="checkbox"
                checked={settings.codexSkipGitCheck}
                onChange={(event) => set('codexSkipGitCheck', event.target.checked)}
              />
              <span>Skip the git-repository check (--skip-git-repo-check).</span>
            </label>
          </div>
        )}

        <h4 className="sb-llm-modal-subtitle">Project editing</h4>

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

        <h4 className="sb-llm-modal-subtitle">Storybook MCP bridge</h4>

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

        <label className="sb-llm-modal-field">
          <span className="sb-llm-modal-label">MCP URL (empty = current origin /mcp)</span>
          <input
            type="text"
            value={settings.mcpUrl}
            onChange={(event) => set('mcpUrl', event.target.value)}
            placeholder="http://localhost:6006/mcp"
          />
        </label>

        <label className="sb-llm-modal-field">
          <span className="sb-llm-modal-label">System prompt</span>
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
