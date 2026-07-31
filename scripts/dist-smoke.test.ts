import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CLI_BIN, ROOT, runCommand, runNode } from './e2e-helpers'

/**
 * Smoke test for the compiled `dist/` artifacts — the exact files that ship to
 * npm. The regular test suite aliases every workspace package to its `src/`,
 * so nothing there can catch a build step corrupting the output. That is how
 * v0.12.3 of generate-parsers shipped dead on arrival: tsc-alias
 * --resolveFullPaths rewrote a regex literal inside the compiled JS into an
 * unparseable pattern, and the CLI crashed with a SyntaxError before doing any
 * work. Everything here runs under plain `node` (no Bun, no aliases, no
 * development export conditions) for the same reason.
 *
 * Requires a prior `bun run build`; run via `bun run test:dist`.
 */

/** Every file shipped under `dist/` by the non-private workspace packages, filtered by suffix. */
const collectDistFiles = async (suffixes: readonly string[]): Promise<string[]> => {
  const files: string[] = []
  const packagesDir = join(ROOT, 'packages')

  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const packageDir = join(packagesDir, entry.name)
    const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf-8')) as {
      name?: string
      private?: boolean
    }
    if (pkg.private) continue

    const distDir = join(packageDir, 'dist')
    if (!existsSync(distDir)) {
      throw new Error(`${pkg.name} has no dist/ directory — run \`bun run build\` before \`bun run test:dist\`.`)
    }

    for (const file of await readdir(distDir, { recursive: true })) {
      if (suffixes.some((suffix) => file.endsWith(suffix))) files.push(join(distDir, file))
    }
  }

  return files
}

/** Every compiled `.js` module shipped by the non-private workspace packages. */
const collectDistModules = async (): Promise<string[]> => collectDistFiles(['.js'])

/**
 * `import`/`export`/`import()`/`require()` specifiers starting with `#` — the
 * subpath-imports form declared in `imports`. Matches the quoted specifier of a
 * `from '...'` clause, a bare `import '...'`, and dynamic `import('...')`.
 */
const SUBPATH_IMPORT = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"])(#[^'"]*)\1/g

/**
 * The helper sources `@amritk/generate-parsers` reads out of an *installed*
 * `@amritk/helpers` in `--helpers=embedded` mode. Mirrors `RuntimeHelperName`
 * in `packages/generate-parsers/src/helpers/collect-helpers.ts`; keep in sync.
 */
const RUNTIME_HELPER_SOURCES = ['has-ref', 'is-object', 'validate-array', 'validate-record'].map(
  (helper) => `src/${helper}.ts`,
)

describe('dist-smoke', () => {
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'mjst-dist-smoke-'))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('the @amritk/helpers tarball ships exactly the runtime-helper sources', async () => {
    // Embedded-mode generation reads `src/<helper>.ts` out of the *installed*
    // @amritk/helpers, so those four sources must survive into the tarball —
    // omitting them (as an earlier `files: ["dist"]` did) made `bunx mjst`
    // crash on a missing `src/is-object.ts`. The rest of `src/` is generator
    // code nothing reads at runtime, and shipping it cost ~110 kB. Asserted
    // against the real packer rather than the `files` array, because the two
    // disagree on negation patterns.
    const { stdout } = await runCommand('npm', ['pack', '--dry-run', '--json'], {
      cwd: join(ROOT, 'packages/helpers'),
    })
    const [tarball] = JSON.parse(stdout) as [{ files: { path: string }[] }]
    const sources = tarball.files.map((file) => file.path).filter((path) => path.startsWith('src/'))

    expect(sources.sort()).toEqual(RUNTIME_HELPER_SOURCES)
  })

  it('no `#` subpath-import specifier survives into dist', async () => {
    // generate-parsers, generate-validators and generate-examples declare
    // `imports: { "#generators/*": "./src/generators/*.ts" }` and publish that
    // map, but their `files` ships no `src/` — so any `#` specifier that
    // reached dist would resolve to a path missing from the tarball. tsc-alias
    // rewrites all of them today; this pins that, because the failure mode
    // (ERR_MODULE_NOT_FOUND only for installed consumers) is invisible to the
    // aliased unit tests and to a repo-local `node dist/...`, where the
    // untrimmed source tree still satisfies the mapping.
    const files = await collectDistFiles(['.js', '.d.ts'])
    expect(files.length).toBeGreaterThan(40)

    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf-8')
      SUBPATH_IMPORT.lastIndex = 0
      let match = SUBPATH_IMPORT.exec(source)
      while (match !== null) {
        offenders.push(`${file.slice(ROOT.length + 1)} → ${match[2]}`)
        match = SUBPATH_IMPORT.exec(source)
      }
    }

    expect(offenders).toEqual([])
  })

  it('every compiled module loads under Node ESM', async () => {
    // cli.js is the bin entry and runs main() on import; the CLI tests below
    // cover it. Everything else must be importable without side effects.
    const modules = (await collectDistModules()).filter((module) => module !== CLI_BIN)

    // The v0.12.3 corruption lived in a single file of a single package. Guard
    // against this sweep silently going dark (say, a dist layout change leaving
    // it with nothing to check) by requiring a meaningful surface.
    expect(modules.length).toBeGreaterThan(20)

    // One child process imports every module. A SyntaxError anywhere in dist —
    // or a relative import Node cannot resolve, e.g. a missing .js extension —
    // fails here with the offending file named.
    const loader = `
      const failures = []
      for (const file of ${JSON.stringify(modules)}) {
        try {
          await import(file)
        } catch (error) {
          failures.push(file + '\\n  ' + error.message)
        }
      }
      if (failures.length > 0) {
        console.error(failures.join('\\n'))
        process.exit(1)
      }
    `
    await runNode(['--input-type=module', '-e', loader])
  })

  it('the built CLI starts and reports its version', async () => {
    const { stdout } = await runNode([CLI_BIN, '--version'])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('the built CLI generates embedded-helper parsers end-to-end', async () => {
    // A record of $refs pulls in the validate-record helper, whose sibling
    // import gets rewritten by the exact regex that the corrupted v0.12.3
    // artifact broke. Asserting the rewrite's *behavior* from dist also catches
    // a mangled-but-still-parseable pattern, not only a load-time SyntaxError.
    const schema = {
      type: 'object',
      properties: { ext: { type: 'object', additionalProperties: { $ref: '#/$defs/item' } } },
      required: ['ext'],
      $defs: { item: { type: 'object', properties: { n: { type: 'string' } }, required: ['n'] } },
    }
    const schemaPath = join(workDir, 'schema.json')
    const outDir = join(workDir, 'out')
    await writeFile(schemaPath, JSON.stringify(schema), 'utf-8')

    await runNode([CLI_BIN, '--schema', schemaPath, '--outDir', outDir, '--helpers', 'embedded'])

    // The CLI defaults --import-ext to 'ts' (no --build here), so the rewritten
    // sibling import lands on the literal on-disk path.
    const validateRecord = await readFile(join(outDir, '_helpers/validate-record.ts'), 'utf-8')
    expect(validateRecord).toContain("from './is-object.ts'")

    // No title, and the schema file is named schema.json, so the root type is
    // derived from the filename → "Schema".
    const root = await readFile(join(outDir, 'schema.ts'), 'utf-8')
    expect(root).toContain('Schema')
  })
})
