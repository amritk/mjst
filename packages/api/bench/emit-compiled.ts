import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileToModule } from '../src/index.ts'
import * as routes from './routes.ts'

/**
 * Build step for `bench/vs-frameworks.ts`, which runs under **Node** so the
 * cross-framework table is measured on V8 — the engine workerd runs. Node
 * cannot load this package's sources directly (they use extensionless
 * imports), so the emitted module is bundled to a single `.mjs` here, with
 * Bun doing the resolving.
 *
 * The output lands in `bench/.fixtures/` (git-ignored) and is imported by
 * path at run time, which also keeps type checkers away from a module that
 * only exists after this step ran.
 */

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures')
mkdirSync(fixtureDir, { recursive: true })

const sourcePath = join(fixtureDir, 'generated-vs-frameworks.ts')
writeFileSync(
  sourcePath,
  compileToModule({
    routesImport: '../routes.ts',
    runtimeImport: '../../src/index.ts',
    validatorsImport: '@amritk/runtime-validators',
    routes: { health: routes.health, getUser: routes.getUser, createUser: routes.createUser },
  }),
)

// `@amritk/runtime-validators` stays external: its `development` export
// condition points at TypeScript sources that use a `@/` path alias the
// bundler can't see, and Node resolves the built package fine on its own.
const bundle = await Bun.build({
  entrypoints: [sourcePath],
  target: 'node',
  external: ['@amritk/runtime-validators'],
})
if (!bundle.success) throw new AggregateError(bundle.logs, 'failed to bundle the compiled engine')
const output = bundle.outputs[0]
if (!output) throw new Error('bundling the compiled engine produced no output')
writeFileSync(join(fixtureDir, 'generated-vs-frameworks.mjs'), await output.text())
