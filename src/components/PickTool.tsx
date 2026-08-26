import React from 'react';
import { useGlobals } from 'storybook/manager-api';

import { KEY } from '../constants';

export const PickTool: React.FC = () => {
  const [globals, updateGlobals] = useGlobals();
  const isPicking = globals[KEY] === true;

  return (
    <button
      type="button"
      className={`sb-llm-tool${isPicking ? ' sb-llm-tool-active' : ''}`}
      aria-pressed={isPicking}
      title="Pick an element of the story to add it to the LLM chat context"
      onClick={() => updateGlobals({ [KEY]: !isPicking })}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M5 1.5l8 13-3.6-1.2L7 15l-1.5-4.5L1 9z" strokeLinejoin="round" />
      </svg>
    </button>
  );
};
