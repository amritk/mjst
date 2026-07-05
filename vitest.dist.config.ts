import { defineConfig } from 'vitest/config'

/**
 * Config for the dist smoke test (scripts/dist-smoke.test.ts) — deliberately
 * without the src/ aliases from vitest.config.ts, because the point is to
 * exercise the compiled dist/ artifacts exactly as they ship to npm.
 * Requires a prior `bun run build`; run via `bun run test:dist`.
 */
export default defineConfig({
  test: {
    include: ['scripts/dist-smoke.test.ts'],
    testTimeout: 60_000,
  },
})
