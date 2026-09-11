import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types';
import { Message } from './Message';

describe('Message', () => {
  it('renders text and tool events in their original timeline order', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: 'FirstFinal',
      parts: [
        { id: 'text-1', type: 'text', content: 'First' },
        { id: 'tool-1', type: 'tool', tool: { id: 'tool-1', name: 'Command', detail: 'npm test', ok: true } },
        { id: 'text-2', type: 'text', content: 'Final' },
      ],
    };

    const html = renderToStaticMarkup(<Message message={message} />);

    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Command'));
    expect(html.indexOf('Command')).toBeLessThan(html.indexOf('Final'));
    expect(html.match(/First/g)).toHaveLength(1);
    expect(html).toContain('<details class="sb-llm-msg-tool">');
    expect(html).not.toContain('<details open');
    expect(html).toContain('<summary>');
  });
});
