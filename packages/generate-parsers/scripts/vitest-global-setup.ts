import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regenerates the runtime-helper snapshot before vitest runs.
 * Required because the snapshot lives under .gitignore and may not exist on a
 * fresh checkout; without it, importing #generated/runtime-helper-sources fails.
 */
export default async (): Promise<void> => {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const buildScript = resolve(scriptDir, 'build-runtime-helpers.ts')
  const result = spawnSync('bun', ['run', buildScript], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Failed to build runtime helpers (exit ${result.status})`)
  }
}
