export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const FILE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_project_files',
      description:
        'List files and folders in a directory of the project (relative to the project root). Use it to explore the project structure before reading or editing files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to the project root, e.g. "src/components". Default: project root.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_project_file',
      description:
        'Read a project source file (path relative to the project root, e.g. "src/components/Button.tsx"). Always read a file before editing it so you return its full content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the project root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_project_file',
      description:
        'Create or overwrite a project file with the given full content (path relative to the project root). Changes are saved to disk permanently and hot-reload in Storybook. Always return the complete file content — this is a full-file replacement, not a patch.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to the project root, e.g. "src/components/Button.tsx".',
          },
          content: { type: 'string', description: 'The complete new file content.' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'update_story_args',
      description:
        'Update the props (args) of the current story via Storybook controls. Use it when the component exposes the property you want to change — check the "Arg types" section in the system message. Pass only the args you want to change.',
      parameters: {
        type: 'object',
        properties: {
          args: {
            type: 'object',
            description: 'Story args to merge into the current story, e.g. {"primary": true, "label": "Save"}',
          },
        },
        required: ['args'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_styles',
      description:
        'Apply temporary CSS style overrides to elements in the story preview, matched by a CSS selector. Use for quick visual experiments only — the overrides disappear on page reload. For permanent changes, use read_project_file + write_project_file instead. Derive the selector from the attached element HTML (tag name + class attribute), e.g. "button.storybook-button".',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector of the element(s) to restyle, e.g. "button.storybook-button"',
          },
          styles: {
            type: 'object',
            description: 'CSS declarations as an object, e.g. {"color": "blue", "font-size": "16px"}',
          },
        },
        required: ['selector', 'styles'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reset_styles',
      description: 'Remove all temporary CSS style overrides previously applied with apply_styles.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

export const TOOL_INSTRUCTIONS = [
  'You can modify the open story, not just describe it.',
  'Use update_story_args to change component props when relevant args exist.',
  'Use apply_styles only for quick visual experiments (lost on reload).',
  'For permanent changes, read the project file with read_project_file, then rewrite it with write_project_file — always output the complete file content, and then verify the result (e.g. via preview_stories if available).',
  'When Storybook MCP tools are available, use them to check component documentation and props before writing code (never guess props), and to run tests after edits.',
  'After applying changes, confirm briefly what you changed (in the user’s language) and how to revert.',
].join(' ');
