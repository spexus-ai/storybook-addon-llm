import { defineConfig, type Options } from 'tsup';

export default defineConfig(async () => {
  // reading the three types of entries from package.json, which has the following structure:
  // {
  //  ...
  //   "bundler": {
  //     "managerEntries": ["./src/manager.ts"],
  //     "previewEntries": ["./src/preview.ts", "./src/index.ts"],
  //     "nodeEntries": ["./src/preset.ts"]
  //   }
  // }
  const packageJson = (await import('./package.json', { with: { type: 'json' } })).default;

  const {
    bundler: { managerEntries = [], previewEntries = [], nodeEntries = [] },
  } = packageJson;

  const commonConfig: Options = {
    clean: false,
    format: ['esm'],
    treeshake: true,
    splitting: true,
    /*
     The following packages are provided by Storybook and should always be externalized
     Meaning they shouldn't be bundled with the addon, and they shouldn't be regular dependencies either.
     Subpaths (react/jsx-runtime, react-dom/client) must be externalized too — otherwise
     bundled libraries (e.g. react-markdown) embed a jsx-runtime that reads the host
     React's internals and crashes when versions mismatch.
    */
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@storybook/icons'],
    /*
     Bundle these into the addon so the consuming project's own React version
     (or a different react-markdown in its node_modules) can't break the panel:
     Storybook would otherwise re-resolve them against the project and hit a
     jsx-runtime/ReactSharedInternals mismatch.
    */
    noExternal: ['marked', 'dompurify'],
    /*
     Inline CSS imports into the JS bundle (injects a <style> tag at runtime),
     because manager entries can't ship separate CSS files.
    */
    injectStyle: true,
  };

  const configs: Options[] = [];

  if (managerEntries.length) {
    configs.push({
      ...commonConfig,
      entry: managerEntries,
      platform: 'browser',
      target: 'esnext',
    });
  }

  if (previewEntries.length) {
    configs.push({
      ...commonConfig,
      entry: previewEntries,
      platform: 'browser',
      target: 'esnext',
      dts: true,
    });
  }

  if (nodeEntries.length) {
    configs.push({
      ...commonConfig,
      entry: nodeEntries,
      platform: 'node',
      target: 'node18',
    });
  }

  return configs;
});
