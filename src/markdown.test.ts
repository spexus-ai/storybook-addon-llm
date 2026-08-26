import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, bold, code and lists', () => {
    const html = renderMarkdown('## Title\n\n**bold** and `code`\n\n- a\n- b');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a</li>');
  });

  it('renders fenced code blocks and links', () => {
    const html = renderMarkdown('```ts\nconst x = 1;\n```\n\n[link](https://example.com)');
    expect(html).toContain('<pre>');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('href="https://example.com"');
  });

  it('renders gfm tables', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('strips script tags and event handlers', () => {
    const html = renderMarkdown('<script>alert(1)</script><p onclick="alert(1)">hi</p>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('hi');
  });
});
