import { chmod } from 'node:fs/promises'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
  onSuccess: async () => {
    // Ensure the bin script is executable when run directly (e.g. `./dist/cli.js`).
    // npm/pnpm also sets this when linking via the `bin` field, but doing it here
    // means `node ./dist/cli.js` and `./dist/cli.js` both work after a fresh build.
    await chmod('dist/cli.js', 0o755)
  },
})
