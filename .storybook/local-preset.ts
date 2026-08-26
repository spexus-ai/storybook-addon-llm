import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { managerEntries as addonPresetManagerEntries } from '../dist/preset.js';

const dir = dirname(fileURLToPath(import.meta.url));

/**
 * to load the built addon in this test Storybook
 */
export function previewAnnotations(entry = []) {
  return [...entry, join(dir, '../dist/preview.js')];
}

export function managerEntries(entry = []) {
  // The addon's preset hook starts the local file server for project file tools.
  return addonPresetManagerEntries([...entry, join(dir, '../dist/manager.js')]);
}
