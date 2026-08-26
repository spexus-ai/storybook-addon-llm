import { describe, expect, it } from 'vitest';

import { isImageUnsupportedError, normalizeBaseURL, parseChunk, parseDelta, parseSSE } from './client';

describe('normalizeBaseURL', () => {
  it('strips trailing slashes', () => {
    expect(normalizeBaseURL('https://api.example.com///')).toBe('https://api.example.com');
    expect(normalizeBaseURL('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  it('trims whitespace', () => {
    expect(normalizeBaseURL('  https://api.example.com  ')).toBe('https://api.example.com');
  });
});

describe('parseSSE', () => {
  it('parses a single complete event', () => {
    const { events, rest } = parseSSE('data: {"a":1}\n\n');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('');
  });

  it('keeps an incomplete line in the rest', () => {
    const { events, rest } = parseSSE('data: {"a":1}\n\ndata: {"b":');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b":');
  });

  it('handles multiple data lines and CRLF', () => {
    const { events, rest } = parseSSE('data: one\r\ndata: two\r\n');
    expect(events).toEqual(['one', 'two']);
    expect(rest).toBe('');
  });

  it('ignores comments and other fields', () => {
    const { events } = parseSSE(': keep-alive\nevent: message\ndata: three\n\n');
    expect(events).toEqual(['three']);
  });

  it('parses an empty string', () => {
    expect(parseSSE('')).toEqual({ events: [], rest: '' });
  });
});

describe('parseDelta', () => {
  it('extracts content deltas', () => {
    expect(parseDelta(JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }))).toBe('Hello');
  });

  it('returns null for [DONE]', () => {
    expect(parseDelta('[DONE]')).toBeNull();
  });

  it('returns null for empty and malformed payloads', () => {
    expect(parseDelta('')).toBeNull();
    expect(parseDelta('not-json')).toBeNull();
    expect(parseDelta(JSON.stringify({ choices: [{ delta: {} }] }))).toBeNull();
    expect(parseDelta(JSON.stringify({ choices: [] }))).toBeNull();
  });

  it('handles structured output (output_text parts)', () => {
    expect(
      parseDelta(
        JSON.stringify({
          choices: [
            {
              delta: {
                content: [
                  { type: 'output_text', text: 'A' },
                  { type: 'output_text', text: 'B' },
                ],
              },
            },
          ],
        }),
      ),
    ).toBe('AB');
  });
});

describe('isImageUnsupportedError', () => {
  it('detects DeepSeek-style image errors', () => {
    expect(isImageUnsupportedError('This model does not support image')).toBe(true);
    expect(isImageUnsupportedError('Invalid content type: image_url')).toBe(true);
    expect(isImageUnsupportedError('The model does not understand image inputs')).toBe(true);
    expect(isImageUnsupportedError('image is not supported by this model version')).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isImageUnsupportedError('Invalid API key')).toBe(false);
    expect(isImageUnsupportedError('Request timed out')).toBe(false);
    expect(isImageUnsupportedError('')).toBe(false);
  });
});

describe('parseChunk', () => {
  it('parses tool-call fragments', () => {
    const chunk = parseChunk(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'call-1', function: { name: 'apply_styles', arguments: '{"selector":' } }],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    expect(chunk.content).toBeNull();
    expect(chunk.toolCalls).toEqual([{ index: 0, id: 'call-1', name: 'apply_styles', arguments: '{"selector":' }]);
    expect(chunk.finishReason).toBeNull();
  });

  it('parses content and finish reason', () => {
    const chunk = parseChunk(JSON.stringify({ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }));
    expect(chunk.content).toBe('Hi');
    expect(chunk.toolCalls).toEqual([]);
    expect(chunk.finishReason).toBe('stop');
  });

  it('returns empty for [DONE] and malformed payloads', () => {
    expect(parseChunk('[DONE]')).toEqual({ content: null, toolCalls: [], finishReason: null });
    expect(parseChunk('nope')).toEqual({ content: null, toolCalls: [], finishReason: null });
  });
});
