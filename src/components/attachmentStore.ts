import type { ElementSnapshot } from '../types';

type Listener = () => void;

/**
 * Module-level store for picked elements.
 * Lives in the manager, so chips survive panel unmounts (e.g. picking
 * from the toolbar while the panel is closed).
 */
class AttachmentStore {
  private items: ElementSnapshot[] = [];
  private error: string | null = null;
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify = (): void => {
    for (const listener of this.listeners) {
      listener();
    }
  };

  getAttachments = (): ElementSnapshot[] => this.items;

  getError = (): string | null => this.error;

  add = (snapshot: ElementSnapshot): void => {
    this.items = [...this.items, snapshot];
    this.notify();
  };

  remove = (id: string): void => {
    this.items = this.items.filter((item) => item.id !== id);
    this.notify();
  };

  clear = (): void => {
    this.items = [];
    this.error = null;
    this.notify();
  };

  reportError = (message: string): void => {
    this.error = message;
    this.notify();
  };

  clearError = (): void => {
    this.error = null;
    this.notify();
  };
}

export const attachmentStore = new AttachmentStore();
