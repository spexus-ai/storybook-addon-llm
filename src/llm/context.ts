import { truncate } from '../utils';
import type {
  ChatMessage,
  ElementSnapshot,
  LLMCallMessage,
  LLMContentPart,
  LLMSettings,
  StoryContextData,
} from '../types';
import { TOOL_INSTRUCTIONS } from './tools';

const MAX_BLOCK_LENGTH = 20000;

function safeStringify(value: unknown, space = 2): string {
  try {
    return JSON.stringify(value, null, space) ?? 'undefined';
  } catch {
    return '[not serializable]';
  }
}

export function formatStoryContext(story: StoryContextData): string {
  const sections: string[] = [`## Current story: ${story.title} — ${story.name}`, `Story id: \`${story.id}\``];

  if (story.importPath) {
    sections.push(
      `### Story file: \`${story.importPath}\``,
      'This file renders the story the user is looking at. To change the component permanently: read it with read_project_file, then rewrite it with write_project_file (full file content).',
    );
  } else if (story.absoluteImportPath) {
    sections.push(`### Story file (absolute): ${story.absoluteImportPath}`);
  }

  if (story.previewUrl) {
    sections.push(`### Storybook URL: ${story.previewUrl}`);
  }

  if (story.source) {
    sections.push('### Component source code', '```tsx', story.source, '```');
  }

  if (story.args && Object.keys(story.args).length) {
    sections.push('### Current args', '```json', safeStringify(story.args), '```');
  }

  if (story.argTypes && Object.keys(story.argTypes).length) {
    sections.push('### Arg types', '```json', safeStringify(story.argTypes), '```');
  }

  return truncate(sections.join('\n\n'), MAX_BLOCK_LENGTH);
}

export function formatElement(snapshot: ElementSnapshot, index: number): string {
  const lines: string[] = [
    `## Selected element #${index}: <${snapshot.tagName}>`,
    `Size: ${snapshot.rect.width}×${snapshot.rect.height} at (${snapshot.rect.x}, ${snapshot.rect.y})`,
  ];

  const a11yEntries = Object.entries(snapshot.accessibility).filter(([, value]) => value !== null && value !== '');
  if (a11yEntries.length) {
    lines.push('Accessibility: ' + a11yEntries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', '));
  }

  const styleEntries = Object.entries(snapshot.computedStyles);
  if (styleEntries.length) {
    lines.push('Computed styles:', '```css', styleEntries.map(([key, value]) => `${key}: ${value};`).join('\n'), '```');
  }

  if (snapshot.innerText.trim()) {
    lines.push('Text content:', '```', snapshot.innerText, '```');
  }

  lines.push('HTML:', '```html', snapshot.outerHTML, '```');

  return truncate(lines.join('\n\n'), MAX_BLOCK_LENGTH);
}

function messageToLLMParts(
  message: Pick<ChatMessage, 'role' | 'content' | 'attachments'>,
  includeImages: boolean,
): string | LLMContentPart[] {
  const parts: LLMContentPart[] = [];
  const attachments = message.attachments ?? [];

  if (attachments.length) {
    parts.push({
      type: 'text',
      text: attachments.map((snapshot, index) => formatElement(snapshot, index + 1)).join('\n\n'),
    });
    if (includeImages) {
      for (const snapshot of attachments) {
        if (snapshot.screenshot) {
          parts.push({ type: 'image_url', image_url: { url: snapshot.screenshot } });
        }
      }
    }
  }

  if (message.content.trim()) {
    parts.push({ type: 'text', text: message.content });
  }

  if (!parts.length) {
    return '';
  }
  if (parts.length === 1 && parts[0].type === 'text') {
    return parts[0].text;
  }
  return parts;
}

export interface BuildMessagesArgs {
  settings: LLMSettings;
  story?: StoryContextData;
  /** Chat history (without the message currently being sent). */
  history: ChatMessage[];
  userContent: string;
  attachments?: ElementSnapshot[];
}

/**
 * Builds a plain-text prompt for the Codex CLI provider. Codex works on the
 * project directory itself (reads/edits files with its own tools), so only
 * the story context, element snapshots and the user message are included.
 */
export function buildCodexPrompt({ settings, story, userContent, attachments }: BuildMessagesArgs): string {
  const sections: string[] = [];

  if (settings.systemPrompt.trim()) {
    sections.push(settings.systemPrompt.trim());
  }

  if (story) {
    sections.push(formatStoryContext(story));
  }

  if (attachments && attachments.length) {
    sections.push(
      'The user attached the following rendered elements of the current story:',
      attachments.map((snapshot, index) => formatElement(snapshot, index + 1)).join('\n\n'),
    );
  }

  sections.push(`User request:\n${userContent}`);

  return sections.join('\n\n');
}

export function buildMessages({
  settings,
  story,
  history,
  userContent,
  attachments,
}: BuildMessagesArgs): LLMCallMessage[] {
  const messages: LLMCallMessage[] = [];

  const systemParts = [settings.systemPrompt.trim(), TOOL_INSTRUCTIONS];
  if (story) {
    systemParts.push(formatStoryContext(story));
  }
  const systemContent = systemParts.filter(Boolean).join('\n\n');
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  for (const message of history) {
    messages.push({
      role: message.role,
      content: messageToLLMParts(message, settings.sendScreenshots),
    });
  }

  messages.push({
    role: 'user',
    content: messageToLLMParts({ role: 'user', content: userContent, attachments }, settings.sendScreenshots),
  });

  return messages;
}
