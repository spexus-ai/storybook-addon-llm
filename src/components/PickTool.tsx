import React from 'react';
import { useGlobals } from 'storybook/manager-api';

import { KEY } from '../constants';
import { InspectIcon } from './InspectIcon';

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
      <InspectIcon />
    </button>
  );
};
