import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_HTML_LENGTH, serializeElement } from './snapshot';

describe('serializeElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures tag, attributes, text, rect and a11y info', () => {
    const button = document.createElement('button');
    button.className = 'btn primary';
    button.setAttribute('type', 'submit');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Save changes');
    button.textContent = 'Save';
    document.body.appendChild(button);

    const snapshot = serializeElement(button, { id: 'test-id', now: 123 });

    expect(snapshot.id).toBe('test-id');
    expect(snapshot.capturedAt).toBe(123);
    expect(snapshot.tagName).toBe('button');
    expect(snapshot.attributes).toEqual({
      class: 'btn primary',
      type: 'submit',
      role: 'button',
      'aria-label': 'Save changes',
    });
    expect(snapshot.innerText).toBe('Save');
    expect(snapshot.outerHTML).toContain('<button');
    expect(snapshot.rect).toMatchObject({ x: 0, y: 0, width: 0, height: 0 });
    expect(snapshot.accessibility.role).toBe('button');
    expect(snapshot.accessibility['aria-label']).toBe('Save changes');
  });

  it('collects computed styles and skips default-ish values', () => {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.gap = '8px';
    document.body.appendChild(div);

    const snapshot = serializeElement(div);

    expect(snapshot.computedStyles.display).toBe('flex');
    expect(snapshot.computedStyles.gap).toBe('8px');
    // defaults are ignored
    expect(snapshot.computedStyles.visibility).toBeUndefined();
    expect(snapshot.computedStyles.opacity).toBeUndefined();
  });

  it('truncates huge markup', () => {
    const div = document.createElement('div');
    div.textContent = 'x'.repeat(MAX_HTML_LENGTH * 2);
    document.body.appendChild(div);

    const snapshot = serializeElement(div);

    expect(snapshot.outerHTML.length).toBeLessThanOrEqual(MAX_HTML_LENGTH + 200);
    expect(snapshot.outerHTML).toContain('truncated');
  });

  it('does not truncate small markup', () => {
    const div = document.createElement('div');
    div.textContent = 'small';
    document.body.appendChild(div);

    const snapshot = serializeElement(div);

    expect(snapshot.outerHTML).toBe('<div>small</div>');
  });
});
