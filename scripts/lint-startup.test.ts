import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CLI_BIN, runNode } from './e2e-helpers'

/**
 * Pins what a small `mjst lint` run loads. Module loading is most of what such a
 * run costs, so `fast-glob`, `@amritk/resolve-refs` and
 * `@amritk/runtime-validators` are only imported once the run needs them — and a
 * stray static import anywhere on the path would quietly undo that. These run the
 * built CLI under plain `node` with a resolve hook that records every module it
 * loads.
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
  delete process.env.LOAD_TRACE
  await rm(dir, { recursive: true, force: true })
})

/** Runs `mjst lint` with `args`, returning its stdout and every module URL it loaded. */
const lintTraced = async (args: string[], trace: string): Promise<{ stdout: string; loaded: string }> => {
  const traceFile = join(dir, `${trace}.trace`)
  await writeFile(traceFile, '')
  process.env.LOAD_TRACE = traceFile
  // A finding exits 1, which `runNode` reports as a failure; the stdout we want
  // to check rides along on the error.
  const stdout = await runNode(['--import', register, CLI_BIN, 'lint', ...args]).then(
    (result) => result.stdout,
    (error: Error) => error.message,
  )
  return { stdout, loaded: await readFile(traceFile, 'utf-8') }
}

describe('lint-startup', () => {
  it('loads neither fast-glob, resolve-refs nor runtime-validators for a plain style check', async () => {
    const { stdout, loaded } = await lintTraced(
      [join(dir, 'spec.json'), '-r', join(dir, 'ruleset.json'), '--no-resolve'],
      'plain',
    )

    expect(stdout).toContain('info-title')
    expect(loaded).toContain('/lint/dist/index.js')
    expect(loaded).not.toContain('fast-glob')
    expect(loaded).not.toContain('resolve-refs')
    expect(loaded).not.toContain('runtime-validators')
  })

  it('loads what the run needs once it needs it', async () => {
    const { stdout, loaded } = await lintTraced([join(dir, 'spec.*'), '-r', join(dir, 'schema-ruleset.json')], 'needed')

    expect(stdout).toContain('info-contact')
    expect(loaded).toContain('fast-glob')
    expect(loaded).toContain('resolve-refs')
    expect(loaded).toContain('runtime-validators')
  })
})
