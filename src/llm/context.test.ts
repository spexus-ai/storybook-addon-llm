import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from './storage';
import { buildCodexPrompt, buildMessages, formatElement, formatStoryContext } from './context';
import type { ChatMessage, ElementSnapshot, LLMContentPart, StoryContextData } from '../types';

const story: StoryContextData = {
  id: 'example-button--primary',
  title: 'Example/Button',
  name: 'Primary',
  args: { primary: true, label: 'Button' },
  argTypes: { label: { control: 'text' } },
  source: 'export const Primary = { args: { primary: true } }',
  importPath: 'src/stories/Button.stories.ts',
  absoluteImportPath: '/project/src/stories/Button.stories.ts',
  previewUrl: 'http://localhost:6008/?path=/story/example-button--primary',
};

const snapshot: ElementSnapshot = {
  id: 'el-1',
  capturedAt: 1,
  tagName: 'button',
  attributes: { class: 'storybook-button', type: 'button' },
  outerHTML: '<button class="storybook-button" type="button">Button</button>',
  innerText: 'Button',
  computedStyles: { display: 'inline-flex', gap: '10px' },
  rect: { x: 0, y: 0, width: 120, height: 40 },
  accessibility: { role: 'button', 'aria-label': 'Save' },
  screenshot: 'data:image/png;base64,AAAA',
};

const settings = { ...DEFAULT_SETTINGS, sendScreenshots: true };

describe('formatStoryContext', () => {
  it('includes story id, source, args and argTypes', () => {
    const block = formatStoryContext(story);
    expect(block).toContain('Example/Button — Primary');
    expect(block).toContain('example-button--primary');
    expect(block).toContain('export const Primary');
    expect(block).toContain('"label": "Button"');
  });

  it('includes the story file path and the storybook URL', () => {
    const block = formatStoryContext(story);
    expect(block).toContain('Story file: `src/stories/Button.stories.ts`');
    expect(block).toContain('read_project_file');
    expect(block).toContain('http://localhost:6008/?path=/story/example-button--primary');
  });
});

describe('formatElement', () => {
  it('includes html, styles, text and accessibility', () => {
    const block = formatElement(snapshot, 1);
    expect(block).toContain('#1');
    expect(block).toContain('<button');
    expect(block).toContain('display: inline-flex');
    expect(block).toContain('Button');
    expect(block).toContain('aria-label');
    expect(block).toContain('120×40');
  });
});

describe('buildMessages', () => {
  it('produces system, history and user messages', () => {
    const history: ChatMessage[] = [{ id: 'a', role: 'assistant', content: 'Hello!' }];

    const messages = buildMessages({
      settings,
      story,
      history,
      userContent: 'What does this button do?',
      attachments: [snapshot],
    });

    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Example/Button');
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(messages[2].role).toBe('user');
  });

  it('attaches element text and screenshot as content parts', () => {
    const messages = buildMessages({
      settings,
      story,
      history: [],
      userContent: 'What is this?',
      attachments: [snapshot],
    });

    const user = messages[1];
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as LLMContentPart[];
    expect(parts.some((part) => part.type === 'image_url')).toBe(true);
    const textParts = parts.filter((part) => part.type === 'text');
    expect(textParts.map((part) => part.text).join('')).toContain('<button');
    expect(textParts.map((part) => part.text).join('')).toContain('What is this?');
  });

  it('omits screenshots when sendScreenshots is disabled', () => {
    const messages = buildMessages({
      settings: { ...settings, sendScreenshots: false },
      story,
      history: [],
      userContent: 'What is this?',
      attachments: [snapshot],
    });

    const parts = messages[1].content as LLMContentPart[];
    expect(parts.some((part) => part.type === 'image_url')).toBe(false);
  });

  it('works without story and attachments', () => {
    const messages = buildMessages({
      settings,
      history: [],
      userContent: 'Hi',
    });

    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });
});

describe('buildCodexPrompt', () => {
  it('includes story context, element text and the user request', () => {
    const prompt = buildCodexPrompt({
      settings,
      story,
      userContent: 'Add two buttons',
      attachments: [snapshot],
    });

    expect(prompt).toContain('Example/Button — Primary');
    expect(prompt).toContain('src/stories/Button.stories.ts');
    expect(prompt).toContain('<button');
    expect(prompt).toContain('User request:\nAdd two buttons');
    expect(prompt).not.toContain('image_url');
  });
});
