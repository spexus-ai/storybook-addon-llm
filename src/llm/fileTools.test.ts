import { afterEach, describe, expect, it, vi } from 'vitest';

import { findFileServer } from './fileTools';

describe('findFileServer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('skips older servers when a capability is required', async () => {
    const fetch = vi.fn(async (url: string) => {
      const port = new URL(url).port;
      return new Response(
        JSON.stringify({
          ok: true,
          service: 'storybook-addon-llm',
          capabilities: port === '6051' ? ['codex-config'] : [],
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    await expect(findFileServer(6050, 'codex-config')).resolves.toBe('http://127.0.0.1:6051');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('accepts legacy addon servers for ordinary file tools', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, service: 'storybook-addon-llm' }))),
    );

    await expect(findFileServer(6050)).resolves.toBe('http://127.0.0.1:6050');
  });
});
