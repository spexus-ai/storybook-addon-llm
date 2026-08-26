import React, { memo, useCallback, useState } from 'react';

import { InspectIcon } from './InspectIcon';

interface ChatInputProps {
  streaming: boolean;
  picking: boolean;
  onTogglePicking: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * Owns its text state so typing never re-renders the chat history above.
 */
export const ChatInput = memo(function ChatInput({
  streaming,
  picking,
  onTogglePicking,
  onSend,
  onStop,
}: ChatInputProps) {
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
      <button
        type="button"
        className={`sb-llm-pick-btn${picking ? ' sb-llm-pick-btn-active' : ''}`}
        aria-pressed={picking}
        title={picking ? 'Stop picking (Esc)' : 'Pick an element of the story for the chat context'}
        onClick={onTogglePicking}
      >
        <InspectIcon />
      </button>
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
