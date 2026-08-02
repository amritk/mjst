import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileToModule } from '../src/index.ts'
import * as routes from './routes.ts'

/**
 * Build step for the cross-framework benchmark, which needs the compiled
 * engine as a *loadable module* in two shapes:
 *
 *   - `generated-vs-frameworks.mjs` — for `bench/vs-frameworks.ts` under Node
 *     and Bun. Node cannot load this package's sources directly (they use
 *     extensionless imports), so it is bundled here with Bun doing the
 *     resolving.
 *   - `workerd-bench.mjs` — the whole benchmark as a Worker, for
 *     `bench/run-workerd.ts`. workerd has no Node built-ins and no bare
 *     specifier resolution, so everything has to be in one bundle.
 *
 * Both start from the same emitted source. The generated worker entry exists
 * so nothing checked into `bench/` has to import a module that only appears
 * after this step ran — it wires the fresh compiled engine into the handler,
 * and both of those imports resolve at bundle time.
 *
 * Everything lands in `bench/.fixtures/` (git-ignored).
 */

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures')
mkdirSync(fixtureDir, { recursive: true })

const compiledPath = join(fixtureDir, 'generated-vs-frameworks.ts')
writeFileSync(
  compiledPath,
  compileToModule({
    routesImport: '../routes.ts',
    runtimeImport: '../../src/index.ts',
    validatorsImport: '@amritk/runtime-validators',
    routes: { health: routes.health, getUser: routes.getUser, createUser: routes.createUser },
  }),
)

const workerEntryPath = join(fixtureDir, 'workerd-entry.ts')
writeFileSync(
  workerEntryPath,
  `import { createBenchHandler } from '../workerd-handler.ts'
import { fetch as compiledFetch } from './generated-vs-frameworks.ts'

export default createBenchHandler(compiledFetch)
`,
)

/**
 * `@amritk/runtime-validators` can't be resolved by the bundler on its own:
 * its `development` export condition points at TypeScript sources that use a
 * `@/` path alias only that package's tsconfig knows about. Node can be left
 * to resolve the built package itself, but workerd resolves nothing at run
 * time, so the worker bundle is pointed straight at the build output — which
 * the build script produces first.
 */
const VALIDATORS_DIST = fileURLToPath(new URL('../../runtime-validators/dist/index.js', import.meta.url))
const validatorsToDist = {
  name: 'runtime-validators-dist',
  setup(build: { onResolve: (options: { filter: RegExp }, callback: () => { path: string }) => void }): void {
    build.onResolve({ filter: /^@amritk\/runtime-validators$/ }, () => ({ path: VALIDATORS_DIST }))
  },
}

const emit = async (entrypoint: string, outputName: string, target: 'node' | 'browser'): Promise<void> => {
  const bundle = await Bun.build({
    entrypoints: [entrypoint],
    target,
    ...(target === 'node'
      ? { external: ['@amritk/runtime-validators'] }
      : { conditions: ['workerd'], plugins: [validatorsToDist] }),
  })
  if (!bundle.success) throw new AggregateError(bundle.logs, `failed to bundle ${outputName}`)
  const output = bundle.outputs[0]
  if (!output) throw new Error(`bundling ${outputName} produced no output`)
  writeFileSync(join(fixtureDir, outputName), await output.text())
}

/**
 * The paired body-read comparison, as its own worker. It shares nothing with
 * the cross-framework bundle on purpose: it measures four ways of reading a
 * body, not four frameworks.
 */
const bodyEntryPath = join(fixtureDir, 'workerd-body-entry.ts')
writeFileSync(
  bodyEntryPath,
  `import { runBodyRounds } from '../body-strategies.ts'

export default {
  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams
    const rounds = Number(params.get('rounds') ?? 7)
    const warmupMs = Number(params.get('warmupMs') ?? 1500)
    return Response.json(await runBodyRounds(rounds, warmupMs))
  },
}
`,
)

await emit(compiledPath, 'generated-vs-frameworks.mjs', 'node')
await emit(workerEntryPath, 'workerd-bench.mjs', 'browser')
await emit(bodyEntryPath, 'workerd-body.mjs', 'browser')
