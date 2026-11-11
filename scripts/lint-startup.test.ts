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
 * run costs, so `fast-glob`, `@amritk/resolve-refs`, `@amritk/runtime-validators`
 * and `@amritk/yaml` are only imported once the run needs them — and a stray
 * static import anywhere on the path would quietly undo that. These run the built
 * CLI under plain `node` with a resolve hook that records every module it loads.
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

const VALIDATORS = '/runtime-validators/dist/index.js'
const YAML = '/packages/yaml/dist/index.js'

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
  await writeFile(join(dir, 'spec.yaml'), 'openapi: 3.1.0\ninfo:\n  version: "1"\npaths: {}\n')
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
    expect(loaded).not.toContain(VALIDATORS)
    expect(loaded).not.toContain(YAML)
  })

  it('loads neither the validator nor the YAML parser for a JSON document with resolving on', async () => {
    const { stdout, loaded } = await lintTraced([join(dir, 'spec.json'), '-r', join(dir, 'ruleset.json')], 'resolve')

    expect(stdout).toContain('info-title')
    expect(loaded).toContain('resolve-refs')
    expect(loaded).not.toContain(VALIDATORS)
    expect(loaded).not.toContain(YAML)
  })

  it('loads what the run needs once it needs it', async () => {
    const { stdout, loaded } = await lintTraced([join(dir, 'spec.*'), '-r', join(dir, 'schema-ruleset.json')], 'needed')

    expect(stdout).toContain('info-contact')
    expect(loaded).toContain('fast-glob')
    expect(loaded).toContain('resolve-refs')
    expect(loaded).toContain(VALIDATORS)
    expect(loaded).toContain(YAML)
  })

  // The library picks how it loads these two through its `#deps/*` imports: on
  // first use where `require()` of an ES module works (the `bun` and
  // `module-sync` conditions), and with the package everywhere else. Node 20.0–20.18
  // and 22.0–22.11, which `engines` still allows, lack `require(esm)`, and there
  // `schema()` and `parseWithPointers` — synchronous and public — have no other
  // way to reach them. Turning `require(esm)` off stands in for those runtimes.
  it('loads both with the package where require(esm) is off', async () => {
    const lint = pathToFileURL(join(ROOT, 'packages/lint/dist/index.js')).href
    const traceFile = join(dir, 'no-require-esm.trace')
    await writeFile(traceFile, '')
    await execFileAsync(
      'node',
      [
        '--no-experimental-require-module',
        '--import',
        register,
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(lint)})`,
      ],
      { env: { ...process.env, LOAD_TRACE: traceFile } },
    )
    const loaded = await readFile(traceFile, 'utf-8')

    expect(loaded).toContain(VALIDATORS)
    expect(loaded).toContain(YAML)
  })

  // Called directly, before any lint run has loaded anything, the synchronous
  // entry points still work: with `require(esm)` on they load on first use, and
  // with it off they were loaded with the package.
  it.each([
    ['node', []],
    ['node', ['--no-experimental-require-module']],
    ['bun', []],
  ])('runs schema and the YAML parser directly under %s %j', async (runtime, flags) => {
    const lint = pathToFileURL(join(ROOT, 'packages/lint/dist/index.js')).href
    const script = `
      const { parseWithPointers, schema } = await import(${JSON.stringify(lint)})
      const direct = schema(1, { schema: { type: 'string' } }, { path: [] })
      const parsed = parseWithPointers('a: [1, 2]\\n')
      console.log(JSON.stringify({ direct: direct.map((r) => r.message), data: parsed.data, range: parsed.getLocationForJsonPath(['a', 1])?.range }))
    `
    const { stdout } = await execFileAsync(runtime, [
      ...flags,
      ...(runtime === 'node' ? ['--input-type=module'] : []),
      '-e',
      script,
    ])

    expect(JSON.parse(stdout)).toEqual({
      direct: ['value must be string'],
      data: { a: [1, 2] },
      range: { start: { line: 0, character: 7 }, end: { line: 0, character: 8 } },
    })
  })

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
