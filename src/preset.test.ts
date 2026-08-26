import { describe, expect, it } from 'vitest';

import { resolveProjectPath } from './preset';

describe('resolveProjectPath', () => {
  const root = '/project/root';

  it('resolves relative paths inside the root', () => {
    expect(resolveProjectPath(root, 'src/Button.tsx')).toBe('/project/root/src/Button.tsx');
    expect(resolveProjectPath(root, '.')).toBe('/project/root');
    expect(resolveProjectPath(root, '')).toBe('/project/root');
  });

  it('allows absolute paths inside the root', () => {
    expect(resolveProjectPath(root, '/project/root/src/Button.tsx')).toBe('/project/root/src/Button.tsx');
  });

  it('blocks traversal outside the root', () => {
    expect(resolveProjectPath(root, '../etc/passwd')).toBeNull();
    expect(resolveProjectPath(root, '/etc/passwd')).toBeNull();
    expect(resolveProjectPath(root, 'src/../../etc/passwd')).toBeNull();
  });

  it('normalizes redundant segments', () => {
    expect(resolveProjectPath(root, 'src//components/./Button.tsx')).toBe('/project/root/src/components/Button.tsx');
  });
});
