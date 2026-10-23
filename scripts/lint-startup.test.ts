import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CLI_BIN, ROOT } from './e2e-helpers'

const execFileAsync = promisify(execFile)

/**
 * Pins what a small `mjst lint` run loads. Module loading is most of what such a
 * run costs, so `fast-glob` and `@amritk/resolve-refs` are only imported once the
 * run needs them — and a stray static import anywhere on the path would quietly
 * undo that. These run the built CLI under plain `node` with a resolve hook that
 * records every module it loads.
 *
 * Requires a prior `bun run build`; run via `bun run test:dist`.
 */

// Appends every resolved module URL to the file named by `LOAD_TRACE`. A sync
// write, because the CLI calls `process.exit` as soon as it has printed.
const TRACE_HOOKS = `
import { appendFileSync } from 'node:fs'
export const resolve = async (specifier, context, next) => {
  const result = await next(specifier, context)
  appendFileSync(process.env.LOAD_TRACE, result.url + '\\n')
  return result
}
`

const RULESET = JSON.stringify({
  rules: {
    'info-title': { given: '$.info', severity: 'error', then: { field: 'title', function: 'truthy' } },
  },
})

const SCHEMA_RULESET = JSON.stringify({
  rules: {
    'info-contact': {
      given: '$.info',
      severity: 'error',
      then: { function: 'schema', functionOptions: { schema: { type: 'object', required: ['contact'] } } },
    },
  },
})

let dir: string
let register: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mjst-lint-startup-'))
  const hooks = join(dir, 'trace-hooks.mjs')
  await writeFile(hooks, TRACE_HOOKS)
  register = join(dir, 'register.mjs')
  await writeFile(
    register,
    `import { register } from 'node:module'\nregister(${JSON.stringify(pathToFileURL(hooks).href)})\n`,
  )
  await writeFile(join(dir, 'spec.json'), '{"openapi":"3.1.0","info":{"version":"1"},"paths":{}}')
  await writeFile(join(dir, 'ruleset.json'), RULESET)
  await writeFile(join(dir, 'schema-ruleset.json'), SCHEMA_RULESET)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Runs `mjst lint` with `args`, returning its stdout and every module URL it loaded. */
const lintTraced = async (args: string[], trace: string): Promise<{ stdout: string; loaded: string }> => {
  const traceFile = join(dir, `${trace}.trace`)
  await writeFile(traceFile, '')
  // A finding exits 1, which rejects; its stdout rides along on the error.
  const stdout = await execFileAsync('node', ['--import', register, CLI_BIN, 'lint', ...args], {
    env: { ...process.env, LOAD_TRACE: traceFile },
  }).then(
    (result) => result.stdout,
    (error: { stdout?: string }) => error.stdout ?? '',
  )
  return { stdout, loaded: await readFile(traceFile, 'utf-8') }
}

describe('lint-startup', () => {
  it('loads neither fast-glob nor resolve-refs for a single file under --no-resolve', async () => {
    const { stdout, loaded } = await lintTraced(
      [join(dir, 'spec.json'), '-r', join(dir, 'ruleset.json'), '--no-resolve'],
      'plain',
    )

    expect(stdout).toContain('info-title')
    expect(loaded).toContain('/lint/dist/index.js')
    expect(loaded).not.toContain('fast-glob')
    expect(loaded).not.toContain('resolve-refs')
  })

  it('loads what the run needs once it needs it', async () => {
    const { stdout, loaded } = await lintTraced([join(dir, 'spec.*'), '-r', join(dir, 'schema-ruleset.json')], 'needed')

    expect(stdout).toContain('info-contact')
    expect(loaded).toContain('fast-glob')
    expect(loaded).toContain('resolve-refs')
  })

  // `@amritk/runtime-validators` stays a static import of the library: `schema`
  // and `createLinter().run()` are public and reach it without any async step to
  // load it in, and `require()` of an ES module — the only synchronous way left —
  // is missing on Node 20.0–20.18 and 22.0–22.11, which `engines` still allows.
  // Turning `require(esm)` off stands in for those runtimes.
  it('validates through createLinter and a direct schema call without require(esm)', async () => {
    const lint = pathToFileURL(join(ROOT, 'packages/lint/dist/index.js')).href
    const script = `
      const { createDocument, createLinter, createRuleset, schema } = await import(${JSON.stringify(lint)})
      const ruleset = createRuleset(${SCHEMA_RULESET})
      const findings = await createLinter(ruleset).run(createDocument('{"info":{}}'))
      const direct = schema(1, { schema: { type: 'string' } }, { path: [] })
      console.log(JSON.stringify({ codes: findings.map((f) => f.code), direct: direct.map((r) => r.message) }))
    `
    const { stdout } = await execFileAsync('node', [
      '--no-experimental-require-module',
      '--input-type=module',
      '-e',
      script,
    ])

    expect(JSON.parse(stdout)).toEqual({ codes: ['info-contact'], direct: ['value must be string'] })
  })
})
