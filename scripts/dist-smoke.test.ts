import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const ROOT = resolve(import.meta.dirname, '..')
const CLI_BIN = join(ROOT, 'packages/cli/dist/cli.js')

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

/**
 * Runs `node` with the given args, folding the child's output into the thrown
 * error so a failure shows what broke, not just a non-zero exit code.
 */
const runNode = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  try {
    return await execFileAsync('node', args)
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; message: string }
    throw new Error([details.message, details.stdout, details.stderr].filter(Boolean).join('\n'))
  }
}

/** Every compiled `.js` module shipped by the non-private workspace packages. */
const collectDistModules = async (): Promise<string[]> => {
  const modules: string[] = []
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
      if (file.endsWith('.js')) modules.push(join(distDir, file))
    }
  }

  return modules
}

describe('dist-smoke', () => {
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'mjst-dist-smoke-'))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
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

    const validateRecord = await readFile(join(outDir, '_helpers/validate-record.ts'), 'utf-8')
    expect(validateRecord).toContain("from './is-object.js'")

    // No title in the schema, so the root type falls back to "Document".
    const root = await readFile(join(outDir, 'document.ts'), 'utf-8')
    expect(root).toContain('Document')
  })
})
