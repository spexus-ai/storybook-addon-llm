import DOMPurify from 'dompurify';
import { marked } from 'marked';

let configured = false;

function configureMarked(): void {
  if (configured) {
    return;
  }
  configured = true;
  marked.setOptions({
    gfm: true,
    breaks: false,
  });
}

/**
 * Renders markdown (from an LLM) to sanitized HTML.
 * Uses marked + DOMPurify so there are no React version coupling issues:
 * the addon bundle never imports react/jsx-runtime.
 */
export function renderMarkdown(markdown: string): string {
  configureMarked();
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'em',
      'del',
      's',
      'u',
      'a',
      'img',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'span',
      'div',
      'input',
    ],
    ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'type', 'checked', 'disabled', 'class', 'id'],
    ALLOW_DATA_ATTR: false,
  });
}
