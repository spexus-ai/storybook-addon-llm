import type { ElementSnapshot } from '../types';
import { truncate, uid } from '../utils';

export const MAX_HTML_LENGTH = 20000;
export const MAX_TEXT_LENGTH = 5000;

const STYLE_PROPS = [
  'display',
  'position',
  'float',
  'clear',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'align-content',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-area',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'border-width',
  'border-style',
  'border-color',
  'background',
  'background-color',
  'background-image',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'white-space',
  'overflow',
  'overflow-x',
  'overflow-y',
  'opacity',
  'cursor',
  'z-index',
  'box-shadow',
  'box-sizing',
  'transform',
  'transition',
  'filter',
  'backdrop-filter',
  'object-fit',
  'outline',
  'user-select',
  'visibility',
];

const IGNORED_STYLE_VALUES = new Set([
  '',
  'none',
  'normal',
  'auto',
  '0px',
  '0s',
  '0ms',
  'rgba(0, 0, 0, 0)',
  'transparent',
  'visible',
  'static',
]);

export interface SerializeOptions {
  id?: string;
  now?: number;
}

export function serializeElement(element: Element, options: SerializeOptions = {}): ElementSnapshot {
  const el = element as HTMLElement;
  const rect = el.getBoundingClientRect();

  const attributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attributes[attr.name] = attr.value;
  }

  const computedStyles: Record<string, string> = {};
  const computed = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  if (computed) {
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (!IGNORED_STYLE_VALUES.has(value)) {
        computedStyles[prop] = value;
      }
    }
  }

  const accessibility: Record<string, string | null> = { role: el.getAttribute('role') };
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('aria-')) {
      accessibility[attr.name] = attr.value;
    }
  }

  return {
    id: options.id ?? uid(),
    capturedAt: options.now ?? Date.now(),
    tagName: el.tagName.toLowerCase(),
    attributes,
    outerHTML: truncate(el.outerHTML, MAX_HTML_LENGTH),
    innerText: truncate(el.innerText || el.textContent || '', MAX_TEXT_LENGTH),
    computedStyles,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    accessibility,
  };
}
