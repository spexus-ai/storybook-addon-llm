import type { LLMSettings } from '../types';

const STORAGE_KEY = 'storybook-addon-llm:settings';

export const DEFAULT_SETTINGS: LLMSettings = {
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  sendScreenshots: true,
  systemPrompt: [
    'You are an expert UI engineer and UX designer assistant embedded in Storybook.',
    'You help the developer understand, review and improve UI components.',
    'The user can attach rendered elements of the current story to their messages.',
    'When the user attaches elements, analyse their HTML, styles and screenshots and answer concretely.',
    'Suggest concrete code changes when asked.',
    'Answer in the same language the user writes in.',
  ].join(' '),
  fileTools: true,
  fileServerPort: 6050,
  mcpBridge: true,
  mcpUrl: '',
  provider: 'api',
  codexPath: 'codex',
  codexSandbox: 'workspace-write',
  codexModel: '',
  codexSession: true,
  codexSkipGitCheck: false,
  codexApproveForMe: true,
};

export function loadSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<LLMSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: LLMSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage may be unavailable (private mode, quota); ignore
  }
}
