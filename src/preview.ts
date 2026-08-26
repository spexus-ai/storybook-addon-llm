import { addons, useEffect, useGlobals } from 'storybook/preview-api';
import type { PartialStoryFn, ProjectAnnotations, Renderer, StoryContext } from 'storybook/internal/types';

import { EVENTS, KEY } from './constants';
import { captureElementScreenshot } from './preview/screenshot';
import { serializeElement } from './preview/snapshot';

const HIGHLIGHT_ID = 'storybook-addon-llm-highlight';
const LABEL_ID = 'storybook-addon-llm-label';
const STYLES_ID = 'storybook-addon-llm-picker-styles';
const OVERRIDES_ID = 'storybook-addon-llm-overrides';
const PICKING_CLASS = 'storybook-addon-llm-picking';

// CSS overrides applied by the LLM (apply_styles tool)
const styleOverrides = new Map<string, Record<string, string>>();

function renderOverrides(): void {
  const rules = [...styleOverrides.entries()]
    .map(([selector, styles]) => {
      const declarations = Object.entries(styles)
        .map(([property, value]) => `${property}: ${value} !important;`)
        .join('\n  ');
      return `${selector} {\n  ${declarations}\n}`;
    })
    .join('\n\n');

  let style = document.getElementById(OVERRIDES_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = OVERRIDES_ID;
    document.head.appendChild(style);
  }
  style.textContent = rules;
}

export function applyStyleOverrides(selector: string, styles: Record<string, string>): void {
  const normalized = selector.trim();
  if (!normalized || !styles || typeof styles !== 'object') {
    return;
  }
  styleOverrides.set(normalized, styles);
  renderOverrides();
}

export function resetStyleOverrides(): void {
  styleOverrides.clear();
  renderOverrides();
}

function injectStyles(): void {
  if (document.getElementById(STYLES_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = `
    #${HIGHLIGHT_ID} {
      position: fixed;
      z-index: 2147483000;
      pointer-events: none;
      border: 2px solid #ff4785;
      background: rgba(255, 71, 133, 0.12);
      border-radius: 2px;
      box-sizing: border-box;
      display: none;
    }
    #${LABEL_ID} {
      position: fixed;
      z-index: 2147483001;
      pointer-events: none;
      display: none;
      background: #ff4785;
      color: #fff;
      font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
      padding: 3px 8px;
      border-radius: 4px;
      white-space: nowrap;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    body.${PICKING_CLASS}, body.${PICKING_CLASS} * {
      cursor: crosshair !important;
    }
  `;
  document.head.appendChild(style);
}

function createOverlay(id: string): HTMLDivElement {
  let element = document.getElementById(id) as HTMLDivElement | null;
  if (!element) {
    element = document.createElement('div');
    element.id = id;
    document.body.appendChild(element);
  }
  return element;
}

class ElementPicker {
  private channel = addons.getChannel();
  private highlight = createOverlay(HIGHLIGHT_ID);
  private label = createOverlay(LABEL_ID);
  private hovered: Element | null = null;
  private removeListeners: Array<() => void> = [];
  private isActive = false;

  private readonly onMouseMove = (event: MouseEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === this.highlight || target === this.label) {
      return;
    }
    this.hovered = target;
    this.reposition(target);
  };

  private readonly onScrollOrResize = () => {
    if (this.hovered) {
      this.reposition(this.hovered);
    }
  };

  private readonly onClick = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = this.hovered;
    if (!target) {
      return;
    }
    this.stop();

    try {
      const snapshot = serializeElement(target);
      try {
        snapshot.screenshot = await captureElementScreenshot(target as HTMLElement);
      } catch (screenshotError) {
        snapshot.screenshotError = screenshotError instanceof Error ? screenshotError.message : String(screenshotError);
      }
      this.channel.emit(EVENTS.ELEMENT_SELECTED, snapshot);
    } catch (error) {
      this.channel.emit(EVENTS.PICK_ERROR, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.stop();
      this.channel.emit(EVENTS.PICK_CANCELLED);
    }
  };

  private reposition(element: Element): void {
    const rect = element.getBoundingClientRect();
    this.highlight.style.display = 'block';
    this.highlight.style.left = `${rect.left}px`;
    this.highlight.style.top = `${rect.top}px`;
    this.highlight.style.width = `${rect.width}px`;
    this.highlight.style.height = `${rect.height}px`;

    const text = `<${element.tagName.toLowerCase()}> ${Math.round(rect.width)}×${Math.round(
      rect.height,
    )} · click to add, Esc to cancel`;
    this.label.textContent = text;
    this.label.style.display = 'block';
    const labelWidth = this.label.offsetWidth;
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - labelWidth - 4));
    this.label.style.left = `${left}px`;
    if (rect.top < 30) {
      this.label.style.top = `${rect.bottom + 6}px`;
    } else {
      this.label.style.top = `${Math.max(4, rect.top - 28)}px`;
    }
  }

  start(): void {
    if (this.isActive) {
      return;
    }
    this.isActive = true;
    injectStyles();
    this.hovered = null;
    document.body.classList.add(PICKING_CLASS);

    const add = <K extends keyof DocumentEventMap>(
      type: K,
      listener: (event: DocumentEventMap[K]) => void,
      options: AddEventListenerOptions = {},
    ) => {
      document.addEventListener(type, listener, options);
      this.removeListeners.push(() => document.removeEventListener(type, listener, options));
    };

    add('mousemove', this.onMouseMove, { capture: true, passive: true });
    add('click', this.onClick, { capture: true });
    add('keydown', this.onKeyDown, { capture: true });
    add('scroll', this.onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', this.onScrollOrResize);
    this.removeListeners.push(() => window.removeEventListener('resize', this.onScrollOrResize));
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }
    this.isActive = false;
    this.hovered = null;
    document.body.classList.remove(PICKING_CLASS);
    this.highlight.style.display = 'none';
    this.label.style.display = 'none';
    for (const remove of this.removeListeners) {
      remove();
    }
    this.removeListeners = [];
  }
}

let picker: ElementPicker | null = null;

function getPicker(): ElementPicker {
  if (!picker) {
    picker = new ElementPicker();
  }
  return picker;
}

export const withLLMPicker = (StoryFn: PartialStoryFn<Renderer>, context: StoryContext<Renderer>) => {
  const [globals] = useGlobals();
  const isPicking = globals[KEY] === true;
  const isStoryView = context.viewMode === 'story';

  useEffect(() => {
    if (!isStoryView) {
      return undefined;
    }
    const channel = addons.getChannel();
    const onApplyStyles = (payload: { selector?: string; styles?: Record<string, string> }) => {
      if (payload?.selector) {
        applyStyleOverrides(payload.selector, payload.styles ?? {});
      }
    };
    const onResetStyles = () => {
      resetStyleOverrides();
    };
    channel.on(EVENTS.APPLY_STYLES, onApplyStyles);
    channel.on(EVENTS.RESET_STYLES, onResetStyles);

    const activePicker = getPicker();
    if (isPicking) {
      activePicker.start();
    } else {
      activePicker.stop();
    }
    return () => {
      activePicker.stop();
      channel.off(EVENTS.APPLY_STYLES, onApplyStyles);
      channel.off(EVENTS.RESET_STYLES, onResetStyles);
    };
  }, [isPicking, isStoryView, context.id]);

  return StoryFn();
};

const preview: ProjectAnnotations<Renderer> = {
  decorators: [withLLMPicker],
  initialGlobals: {
    [KEY]: false,
  },
};

export default preview;
