// Read automatically by `npx web-ext build | lint | run`: keeps dev files out of the package.
export default {
  ignoreFiles: ['scripts', 'scripts/**', 'docs', 'docs/**', 'CLAUDE.md', 'README.md', 'web-ext-config.mjs'],
  build: {
    filename: 'butter-tab-volume-booster-{version}.xpi',
    overwriteDest: true,
  },
};
