import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ChatMessage } from '../types';

export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`sb-llm-msg${isUser ? ' sb-llm-msg-user' : ' sb-llm-msg-assistant'}`}>
      <div className="sb-llm-msg-role">{isUser ? 'You' : 'Assistant'}</div>

      {message.attachments && message.attachments.length > 0 && (
        <div className="sb-llm-msg-attachments">
          {message.attachments.map((attachment, index) => (
            <div key={attachment.id} className="sb-llm-msg-attachment">
              {attachment.screenshot ? (
                <img src={attachment.screenshot} alt={`Screenshot of <${attachment.tagName}> (#${index + 1})`} />
              ) : (
                <div className="sb-llm-msg-attachment-missing">
                  {attachment.screenshotError ? 'Screenshot failed' : 'No screenshot'}
                </div>
              )}
              <code className="sb-llm-msg-attachment-tag">&lt;{attachment.tagName}&gt;</code>
              {attachment.screenshotError && (
                <span className="sb-llm-msg-attachment-warn" title={attachment.screenshotError}>
                  !
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {message.tools && message.tools.length > 0 && (
        <div className="sb-llm-msg-tools">
          {message.tools.map((tool) => (
            <div key={tool.id} className={`sb-llm-msg-tool${tool.ok ? '' : ' sb-llm-msg-tool-fail'}`}>
              <code className="sb-llm-msg-tool-name">{tool.name}</code>
              <span className="sb-llm-msg-tool-detail">{tool.detail}</span>
            </div>
          ))}
        </div>
      )}

      {message.content ? (
        <div className="sb-llm-msg-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      ) : !message.error && !(message.tools && message.tools.length > 0) ? (
        <div className="sb-llm-msg-pending">Thinking…</div>
      ) : null}

      {message.error && (
        <div className="sb-llm-msg-error">
          <strong>Error:</strong> {message.error}
        </div>
      )}
    </div>
  );
});
