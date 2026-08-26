import React from 'react';

import type { ElementSnapshot } from '../types';

interface ContextChipsProps {
  attachments: ElementSnapshot[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

export const ContextChips: React.FC<ContextChipsProps> = ({ attachments, onRemove, onClear }) => (
  <div className="sb-llm-chips">
    <span className="sb-llm-chips-title">Context ({attachments.length}):</span>
    {attachments.map((attachment, index) => (
      <span
        key={attachment.id}
        className="sb-llm-chip"
        title={`<${attachment.tagName}> — will be sent with your next message`}
      >
        {attachment.screenshot && <img className="sb-llm-chip-img" src={attachment.screenshot} alt="" />}
        <code>&lt;{attachment.tagName}&gt;</code>
        {attachment.screenshotError && (
          <span className="sb-llm-chip-warn" title={`Screenshot failed: ${attachment.screenshotError}`}>
            !
          </span>
        )}
        <button
          type="button"
          className="sb-llm-chip-remove"
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove element #${index + 1} from context`}
        >
          ×
        </button>
      </span>
    ))}
    {attachments.length > 1 && (
      <button type="button" className="sb-llm-chips-clear" onClick={onClear}>
        Clear all
      </button>
    )}
  </div>
);
