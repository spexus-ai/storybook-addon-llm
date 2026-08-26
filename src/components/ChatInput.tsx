import React, { memo, useCallback, useState } from 'react';

interface ChatInputProps {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * Owns its text state so typing never re-renders the chat history above.
 */
export const ChatInput = memo(function ChatInput({ streaming, onSend, onStop }: ChatInputProps) {
  const [value, setValue] = useState('');

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || streaming) {
      return;
    }
    setValue('');
    onSend(text);
  }, [value, streaming, onSend]);

  return (
    <div className="sb-llm-input-row">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about this story… (Enter to send, Shift+Enter for a new line)"
        rows={2}
      />
      {streaming ? (
        <button type="button" className="sb-llm-send" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="button" className="sb-llm-send" onClick={submit} disabled={!value.trim()}>
          Send
        </button>
      )}
    </div>
  );
});
