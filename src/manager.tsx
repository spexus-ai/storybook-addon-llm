import React from 'react';
import { addons, types } from 'storybook/manager-api';

import { ADDON_ID, EVENTS, KEY, PANEL_ID, TOOL_ID } from './constants';
import { attachmentStore } from './components/attachmentStore';
import { Panel } from './components/Panel';
import { PickTool } from './components/PickTool';
import type { ElementSnapshot } from './types';
import './components/panel.css';

addons.register(ADDON_ID, (api) => {
  const channel = addons.getChannel();

  channel.on(EVENTS.ELEMENT_SELECTED, (snapshot: ElementSnapshot) => {
    attachmentStore.add(snapshot);
    api.updateGlobals({ [KEY]: false });
  });

  channel.on(EVENTS.PICK_CANCELLED, () => {
    api.updateGlobals({ [KEY]: false });
  });

  channel.on(EVENTS.PICK_ERROR, (payload: { message: string }) => {
    attachmentStore.reportError(payload?.message ?? 'Failed to capture element');
    api.updateGlobals({ [KEY]: false });
  });

  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'LLM Chat',
    match: ({ viewMode }) => viewMode === 'story',
    render: ({ active }) => <Panel active={!!active} />,
  });

  addons.add(TOOL_ID, {
    type: types.TOOL,
    title: 'Pick element for LLM',
    match: ({ viewMode }) => viewMode === 'story',
    render: () => <PickTool />,
  });
});
