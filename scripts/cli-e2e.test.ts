import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CLI_BIN, ROOT, runCommand, runNode } from './e2e-helpers'
import { type PackageJson, resolveProtocols } from './workspace-protocol'

/**
 * End-to-end tests for the full pipeline an npm consumer runs: JSON Schema →
 * built CLI (dist/) → generated TypeScript → `--build` compile via tsc →
 * parse/validate behavior under plain Node ESM. These exist because the
 * 0.7.15 evaluation found gaps that only show up in the *runtime behavior* of
 * generated parsers, which the unit tests (asserting on generated source text)
 * cannot see.
 *
 * Tests marked `it.fails` pin known-open generator gaps: they pass while the
 * gap exists and fail loudly the moment a change fixes (or shifts) the
 * behavior, so the marker must be removed and the assertions promoted to real
 * coverage. See each test's comment for the gap it pins.
 *
 * Requires a prior `bun run build`; run via `bun run test:dist`.
 */

// Node can execute the generated .ts directly only via type stripping
// (22.6+ behind a flag, 23+ by default). Skip that pin on older runtimes.
const [nodeMajor = 0, nodeMinor = 0] = execFileSync('node', ['--version'], { encoding: 'utf-8' })
  .trim()
  .slice(1)
  .split('.')
  .map(Number)
const supportsTypeStripping = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 6)
const stripTypesArgs = nodeMajor >= 23 ? [] : ['--experimental-strip-types']
// Tests that need Node's type stripping only run on a runtime that supports it.
const itWithTypeStripping = supportsTypeStripping ? it : it.skip

/** Object with a nested inline object carrying an enum, plus a minItems array. */
const PLAN_SCHEMA = {
  title: 'Plan',
  type: 'object',
  properties: {
    axiom: {
      type: 'object',
      properties: { kind: { enum: ['assume', 'derive'] }, name: { type: 'string' } },
      required: ['kind'],
    },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
  },
  required: ['axiom'],
}

/** Array items that are inline objects carrying a nested enum and a $ref. */
const WORKFLOW_SCHEMA = {
  title: 'Workflow',
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { enum: ['manual', 'auto'] },
          owner: { $ref: '#/$defs/person' },
        },
        required: ['kind'],
      },
    },
  },
  required: ['steps'],
  $defs: {
    person: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
}

/** A definition that is itself a recursive union — the spec-plan `expr` shape. */
const AST_SCHEMA = {
  title: 'Ast',
  $ref: '#/$defs/expr',
  $defs: {
    expr: {
      oneOf: [
        {
          type: 'object',
          properties: { kind: { const: 'lit' }, value: { type: 'number' } },
          required: ['kind', 'value'],
        },
        {
          type: 'object',
          properties: { kind: { const: 'add' }, left: { $ref: '#/$defs/expr' }, right: { $ref: '#/$defs/expr' } },
          required: ['kind', 'left', 'right'],
        },
      ],
    },
  },
}

/** The outcome of one probe expression evaluated inside the child Node process. */
type Probe = { ok: boolean; value?: unknown; error?: string }

describe('cli-e2e', () => {
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'mjst-cli-e2e-'))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  /**
   * Writes the schema, runs the built CLI on it, and returns the output dir.
   * The CLI runs with cwd at the repo root so `--build`'s `npx tsc` resolves
   * the workspace TypeScript install.
   */
  const generate = async (name: string, schema: object, flags: string[]): Promise<string> => {
    const caseDir = join(workDir, name)
    await mkdir(caseDir, { recursive: true })
    const schemaPath = join(caseDir, 'schema.json')
    await writeFile(schemaPath, JSON.stringify(schema), 'utf-8')
    const outDir = join(caseDir, 'out')
    await runNode([CLI_BIN, '--schema', schemaPath, '--outDir', outDir, '--helpers', 'embedded', ...flags], {
      cwd: ROOT,
    })
    return outDir
  }

  /**
   * Imports the compiled module in a child Node process and evaluates each
   * probe expression (with the module bound to `m`), reporting per-probe
   * outcomes. A child process keeps the runtime plain Node ESM — no vitest
   * transforms or aliases between the generated code and the assertion.
   */
  const runProbes = async (moduleFile: string, probes: Record<string, string>): Promise<Record<string, Probe>> => {
    const script = `
      const m = await import(${JSON.stringify(moduleFile)})
      const attempt = (fn) => {
        try { return { ok: true, value: fn() } }
        catch (error) { return { ok: false, error: String(error?.message ?? error) } }
      }
      const results = {}
      ${Object.entries(probes)
        .map(([name, expression]) => `results[${JSON.stringify(name)}] = attempt(() => (${expression}))`)
        .join('\n      ')}
      console.log(JSON.stringify(results))
    `
    const { stdout } = await runNode(['--input-type=module', '-e', script])
    return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, Probe>
  }

  it('prints usage when invoked with no arguments', async () => {
    const { stdout } = await runNode([CLI_BIN])
    expect(stdout).toContain('Usage:')
    expect(stdout).toContain('--schema')
    expect(stdout).toContain('--import-ext')
    expect(stdout).toContain('--root-type')
  })

  it('prints usage for --help and -h', async () => {
    const long = await runNode([CLI_BIN, '--help'])
    const short = await runNode([CLI_BIN, '-h'])
    expect(long.stdout).toContain('Usage:')
    expect(short.stdout).toContain('Usage:')
  })

  it('derives the root type name from the schema filename when there is no title', async () => {
    const caseDir = join(workDir, 'filename-root')
    await mkdir(caseDir, { recursive: true })
    const schemaPath = join(caseDir, 'spec-plan.json')
    await writeFile(
      schemaPath,
      JSON.stringify({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
      'utf-8',
    )
    const outDir = join(caseDir, 'out')
    await runNode([CLI_BIN, '--schema', schemaPath, '--outDir', outDir, '--helpers', 'embedded'])

    // spec-plan.json → SpecPlan / parseSpecPlan, not the old generic Document.
    const root = await readFile(join(outDir, 'specplan.ts'), 'utf-8')
    expect(root).toContain('SpecPlan')
    const index = await readFile(join(outDir, 'index.ts'), 'utf-8')
    expect(index).toContain('parseSpecPlan')
  })

  it('overrides the root type name with --root-type on a single schema', async () => {
    const caseDir = join(workDir, 'root-type-flag')
    await mkdir(caseDir, { recursive: true })
    const schemaPath = join(caseDir, 'schema.json')
    await writeFile(schemaPath, JSON.stringify({ type: 'object', properties: { n: { type: 'string' } } }), 'utf-8')
    const outDir = join(caseDir, 'out')
    await runNode([
      CLI_BIN,
      '--schema',
      schemaPath,
      '--outDir',
      outDir,
      '--helpers',
      'embedded',
      '--root-type',
      'Program',
    ])

    const index = await readFile(join(outDir, 'index.ts'), 'utf-8')
    expect(index).toContain('parseProgram')
  })

  it('rejects --root-type combined with --schema-dir', async () => {
    const caseDir = join(workDir, 'root-type-schema-dir')
    await mkdir(join(caseDir, 'schemas'), { recursive: true })
    await writeFile(join(caseDir, 'schemas/a.json'), JSON.stringify({ type: 'object' }), 'utf-8')
    await expect(
      runNode([
        CLI_BIN,
        '--schema-dir',
        join(caseDir, 'schemas'),
        '--outDir',
        join(caseDir, 'out'),
        '--root-type',
        'Program',
      ]),
    ).rejects.toThrow(/--root-type cannot be combined with --schema-dir/)
  })

  it('auto-detects package mode from a declared @amritk/helpers dependency', async () => {
    // A consumer project that declares @amritk/helpers: auto-detection must
    // pick 'package' so generated code imports from the shared install.
    const projectDir = join(workDir, 'declared-helpers')
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'consumer', dependencies: { '@amritk/helpers': '^0.1.0' } }),
      'utf-8',
    )
    const schemaPath = join(projectDir, 'schema.json')
    await writeFile(schemaPath, JSON.stringify({ title: 'Doc', type: 'object' }), 'utf-8')
    const outDir = join(projectDir, 'out')
    const { stdout } = await runNode([CLI_BIN, '--schema', schemaPath, '--outDir', outDir])
    expect(stdout).toContain('Helpers mode: package (auto-detected)')
  })

  it('falls back to embedded mode with a tip when @amritk/helpers is undeclared', async () => {
    // No package.json above the output dir → embedded, plus the nudge to
    // declare @amritk/helpers.
    const projectDir = join(workDir, 'undeclared-helpers')
    await mkdir(projectDir, { recursive: true })
    const schemaPath = join(projectDir, 'schema.json')
    await writeFile(schemaPath, JSON.stringify({ title: 'Doc', type: 'object', properties: {} }), 'utf-8')
    const outDir = join(projectDir, 'out')
    const { stdout } = await runNode([CLI_BIN, '--schema', schemaPath, '--outDir', outDir])
    expect(stdout).toContain('Helpers mode: embedded (auto-detected)')
    expect(stdout).toContain('Tip: add @amritk/helpers as a dependency')
  })

  // Pins the 0.7.15 fix: minItems used to be silently ignored, so empty
  // `ensures`/`axioms` arrays sailed through downstream parsers.
  it('enforces minItems at runtime in strict mode', async () => {
    const outDir = await generate(
      'min-items',
      {
        title: 'Doc',
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 1 } },
        required: ['tags'],
      },
      ['--strict', '--build'],
    )
    const probes = await runProbes(join(outDir, 'index.js'), {
      valid: "m.parseDoc({ tags: ['a'] })",
      empty: 'm.parseDoc({ tags: [] })',
      notArray: "m.parseDoc({ tags: 'a' })",
      validShape: "m.validateDocShape({ tags: ['a'] })",
      emptyShape: 'm.validateDocShape({ tags: [] })',
    })

    expect(probes.valid?.ok).toBe(true)
    expect(probes.empty?.ok).toBe(false)
    expect(probes.empty?.error).toContain('at least 1')
    expect(probes.notArray?.ok).toBe(false)
    expect(probes.validShape?.value).toBe(true)
    expect(probes.emptyShape?.value).toBe(false)
  })

  // Regression pin: the strict slow path used to check only array length and
  // uniqueness, letting a number slip into a declared `string[]`.
  it('rejects wrong-typed array items in strict mode', async () => {
    const outDir = await generate(
      'array-item-types',
      {
        title: 'Doc',
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 1 } },
        required: ['tags'],
      },
      ['--strict', '--build'],
    )
    const probes = await runProbes(join(outDir, 'index.js'), {
      wrongItemType: 'm.parseDoc({ tags: [1] })',
    })

    expect(probes.wrongItemType?.ok).toBe(false)
  })

  it('rejects invalid nested enum values in strict mode', async () => {
    const outDir = await generate('nested-enum-strict', PLAN_SCHEMA, ['--strict', '--build'])
    const probes = await runProbes(join(outDir, 'index.js'), {
      valid: "m.parsePlan({ axiom: { kind: 'assume', name: 'n' } })",
      badKind: "m.parsePlan({ axiom: { kind: 'nonsense' } })",
    })

    expect(probes.valid?.ok).toBe(true)
    expect((probes.valid?.value as { axiom: { kind: string } }).axiom.kind).toBe('assume')
    expect(probes.badKind?.ok).toBe(false)
    expect(probes.badKind?.error).toContain('must be one of')
  })

  // Lax mode intentionally coerces instead of throwing; pin that an invalid
  // nested enum value becomes a member of the enum rather than leaking through.
  it('coerces an invalid nested enum value to a schema default in lax mode', async () => {
    const outDir = await generate('nested-enum-lax', PLAN_SCHEMA, ['--build'])
    const probes = await runProbes(join(outDir, 'index.js'), {
      badKind: "m.parsePlan({ axiom: { kind: 'nonsense' } })",
    })

    expect(probes.badKind?.ok).toBe(true)
    const kind = (probes.badKind?.value as { axiom: { kind: string } }).axiom.kind
    expect(['assume', 'derive']).toContain(kind)
  })

  // Regression pin: array items that are inline objects used to pass through
  // with only an Array.isArray check — a nested enum or $ref value inside an
  // element was never validated in either mode.
  it('validates nested enum and $ref values inside array items in strict mode', async () => {
    const outDir = await generate('array-item-nested-strict', WORKFLOW_SCHEMA, ['--strict', '--build'])
    const probes = await runProbes(join(outDir, 'index.js'), {
      valid: "m.parseWorkflow({ steps: [{ kind: 'manual', owner: { name: 'a' } }] })",
      badEnum: "m.parseWorkflow({ steps: [{ kind: 'bogus' }] })",
      badRef: "m.parseWorkflow({ steps: [{ kind: 'auto', owner: { name: 7 } }] })",
      validShape: "m.validateWorkflowShape({ steps: [{ kind: 'manual' }] })",
      badShape: "m.validateWorkflowShape({ steps: [{ kind: 'bogus' }] })",
    })

    expect(probes.valid?.ok).toBe(true)
    expect(probes.badEnum?.ok).toBe(false)
    expect(probes.badEnum?.error).toContain('must be one of')
    expect(probes.badRef?.ok).toBe(false)
    expect(probes.validShape?.value).toBe(true)
    expect(probes.badShape?.value).toBe(false)
  })

  it('coerces invalid nested enum values inside array items in lax mode', async () => {
    const outDir = await generate('array-item-nested-lax', WORKFLOW_SCHEMA, ['--build'])
    const probes = await runProbes(join(outDir, 'index.js'), {
      coerced: "m.parseWorkflow({ steps: [{ kind: 'bogus' }, { kind: 'auto' }] })",
    })

    expect(probes.coerced?.ok).toBe(true)
    const steps = (probes.coerced?.value as { steps: { kind: string }[] }).steps
    expect(steps[1]?.kind).toBe('auto')
    expect(['manual', 'auto']).toContain(steps[0]?.kind)
  })

  // Cross-file $refs are the main consumers of the `.js`-suffixed relative
  // imports from the 0.7.15 evaluation — this proves the generated files
  // import each other, compile, and enforce deeply nested refs under Node.
  it('parses cross-file $ref definitions at runtime', async () => {
    const outDir = await generate(
      'cross-file-refs',
      {
        title: 'Catalog',
        type: 'object',
        properties: {
          owner: { $ref: '#/$defs/person' },
          items: { type: 'array', items: { $ref: '#/$defs/item' } },
        },
        required: ['owner'],
        $defs: {
          person: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          item: {
            type: 'object',
            properties: { id: { type: 'string' }, by: { $ref: '#/$defs/person' } },
            required: ['id'],
          },
        },
      },
      ['--strict', '--build'],
    )
    const probes = await runProbes(join(outDir, 'index.js'), {
      valid: "m.parseCatalog({ owner: { name: 'a' }, items: [{ id: 'x', by: { name: 'b' } }] })",
      badRef: 'm.parseCatalog({ owner: { name: 1 } })',
      badDeepRef: "m.parseCatalog({ owner: { name: 'a' }, items: [{ id: 'x', by: { name: 2 } }] })",
      validShape: "m.validateCatalogShape({ owner: { name: 'a' } })",
    })

    expect(probes.valid?.ok).toBe(true)
    expect(probes.badRef?.ok).toBe(false)
    expect(probes.badDeepRef?.ok).toBe(false)
    expect(probes.validShape?.value).toBe(true)
  })

  it('generates runnable parsers for a schema directory tree', async () => {
    const caseDir = join(workDir, 'schema-dir')
    await mkdir(join(caseDir, 'schemas/nested'), { recursive: true })
    await writeFile(
      join(caseDir, 'schemas/doc.json'),
      JSON.stringify({
        title: 'Doc',
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 1 } },
        required: ['tags'],
      }),
      'utf-8',
    )
    await writeFile(join(caseDir, 'schemas/nested/plan.json'), JSON.stringify(PLAN_SCHEMA), 'utf-8')
    const outDir = join(caseDir, 'out')
    await runNode(
      [
        CLI_BIN,
        '--schema-dir',
        join(caseDir, 'schemas'),
        '--outDir',
        outDir,
        '--helpers',
        'embedded',
        '--strict',
        '--build',
      ],
      { cwd: ROOT },
    )

    // Nested outputs import the shared _helpers/ at the output root via ../..
    // prefixes — both must resolve and enforce under plain Node.
    const docProbes = await runProbes(join(outDir, 'doc/index.js'), {
      valid: "m.parseDoc({ tags: ['a'] })",
      empty: 'm.parseDoc({ tags: [] })',
    })
    const planProbes = await runProbes(join(outDir, 'nested/plan/index.js'), {
      badKind: "m.parsePlan({ axiom: { kind: 'nonsense' } })",
    })

    expect(docProbes.valid?.ok).toBe(true)
    expect(docProbes.empty?.ok).toBe(false)
    expect(planProbes.badKind?.ok).toBe(false)
  })

  it('emits a compilable single-file types-only output with --out-file', async () => {
    const caseDir = join(workDir, 'types-only')
    await mkdir(caseDir, { recursive: true })
    const schemaPath = join(caseDir, 'schema.json')
    await writeFile(schemaPath, JSON.stringify(PLAN_SCHEMA), 'utf-8')
    const outFile = join(caseDir, 'combined.ts')
    await runNode([CLI_BIN, '--schema', schemaPath, '--out-file', outFile, '--types-only', '--build'], { cwd: ROOT })

    // --build with --types-only compiles declaration-only and removes the .ts.
    const declaration = await readFile(join(caseDir, 'combined.d.ts'), 'utf-8')
    expect(declaration).toContain('type Plan')
    expect(declaration).not.toContain('parsePlan')
  })

  // Regression pin: a oneOf property used to get its type generated but no
  // validation at all — strict mode now throws on a value matching no variant,
  // and the shape validator is a real membership predicate.
  it('validates property-level union values in strict mode', async () => {
    const outDir = await generate(
      'property-union',
      {
        title: 'Shape',
        type: 'object',
        properties: {
          figure: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { const: 'circle' }, r: { type: 'number' } },
                required: ['kind', 'r'],
              },
              {
                type: 'object',
                properties: { kind: { const: 'rect' }, w: { type: 'number' }, h: { type: 'number' } },
                required: ['kind', 'w', 'h'],
              },
            ],
          },
        },
        required: ['figure'],
      },
      ['--strict', '--build'],
    )
    const probes = await runProbes(join(outDir, 'index.js'), {
      circle: "m.parseShape({ figure: { kind: 'circle', r: 1 } })",
      garbage: "m.parseShape({ figure: { kind: 'bogus' } })",
      validShape: "m.validateShapeShape({ figure: { kind: 'circle', r: 1 } })",
    })

    expect(probes.circle?.ok).toBe(true)
    expect(probes.garbage?.ok).toBe(false)
    expect(probes.validShape?.value).toBe(true)
  })

  // Regression pin: nested inline objects with enum properties used to stub
  // their shape validator to `=> false`, making the exported
  // validate{Type}Shape reject valid input.
  it('exported shape validators accept valid nested inline objects', async () => {
    const outDir = await generate('nested-shape', PLAN_SCHEMA, ['--strict', '--build'])
    const probes = await runProbes(join(outDir, 'index.js'), {
      validShape: "m.validatePlanShape({ axiom: { kind: 'assume' } })",
    })

    expect(probes.validShape?.value).toBe(true)
  })

  // Regression pin: a definition that is itself a union (file-level oneOf)
  // used to get a blind-cast parser and a `=> false` shape validator — the
  // stubbed recursive `expr` parser from the 0.7.15 evaluation. Strict mode
  // now enforces membership recursively through the branch $refs.
  it('generates a working parser for a file-level union definition', async () => {
    const outDir = await generate('union-def', AST_SCHEMA, ['--strict', '--build'])
    const probes = await runProbes(join(outDir, 'index.js'), {
      validLit: "m.parseExpr({ kind: 'lit', value: 1 })",
      validNested: "m.parseExpr({ kind: 'add', left: { kind: 'lit', value: 1 }, right: { kind: 'lit', value: 2 } })",
      garbage: "m.parseExpr({ kind: 'bogus' })",
      validShape: "m.validateExprShape({ kind: 'lit', value: 1 })",
    })

    expect(probes.validLit?.ok).toBe(true)
    expect(probes.validNested?.ok).toBe(true)
    expect(probes.garbage?.ok).toBe(false)
    expect(probes.validShape?.value).toBe(true)
  })

  // Regression pin: a root $ref whose derived name matches its definition
  // (title "Expr" → #/$defs/expr) used to emit a self-importing, uncompilable
  // wrapper. The walker now merges the definition into the root file.
  it('handles a root $ref whose name collides with its definition', async () => {
    const outDir = await generate('root-ref-collision', { ...AST_SCHEMA, title: 'Expr' }, ['--strict', '--build'])
    const probes = await runProbes(join(outDir, 'index.js'), {
      garbage: "m.parseExpr({ kind: 'bogus' })",
    })

    expect(probes.garbage?.ok).toBe(false)
  })

  // The default is now `--import-ext ts`: without --build the generated .ts
  // sources import siblings as `./x.ts`, the literal on-disk path Node type
  // stripping resolves. This is the main-fix regression pin — generated output
  // must run under plain `node` with no build step and no explicit flag.
  // WORKFLOW_SCHEMA has a cross-file $ref (steps[].owner → #/$defs/person), so
  // the generated index imports a sibling module — the exact relative-import
  // path that broke under Node before `.ts` became the default extension.
  itWithTypeStripping('generated .ts sources run directly under Node type stripping by default', async () => {
    const outDir = await generate('type-stripping', WORKFLOW_SCHEMA, ['--strict'])

    // The sibling module is imported with the literal `.ts` path so Node type
    // stripping resolves it (it does not remap `.js` → `.ts`).
    const index = await readFile(join(outDir, 'index.ts'), 'utf-8')
    expect(index).toContain(".ts'")
    expect(index).not.toContain(".js'")

    const script = `
      import { parseWorkflow } from ${JSON.stringify(join(outDir, 'index.ts'))}
      parseWorkflow({ steps: [{ kind: 'manual', owner: { name: 'a' } }] })
      let threw = false
      try { parseWorkflow({ steps: [{ kind: 'bogus' }] }) } catch { threw = true }
      if (!threw) throw new Error('strict parser did not reject a bad nested enum')
      console.log('ok')
    `
    const scriptPath = join(outDir, 'probe.ts')
    await writeFile(scriptPath, script, 'utf-8')
    const { stdout } = await runNode([...stripTypesArgs, scriptPath])
    expect(stdout).toContain('ok')
  })

  // --import-ext ts is now the default, but keep the explicit form working too:
  // literal `.ts` specifiers (cross-file $refs, the index barrel, embedded
  // _helpers) so the sources are directly runnable under Node type stripping.
  itWithTypeStripping('runs generated sources under Node type stripping with --import-ext ts', async () => {
    const outDir = await generate('import-ext-ts', WORKFLOW_SCHEMA, ['--strict', '--import-ext', 'ts'])

    const script = `
      import { parseWorkflow } from ${JSON.stringify(join(outDir, 'index.ts'))}
      parseWorkflow({ steps: [{ kind: 'manual', owner: { name: 'a' } }] })
      let threw = false
      try { parseWorkflow({ steps: [{ kind: 'bogus' }] }) } catch { threw = true }
      if (!threw) throw new Error('strict parser did not reject a bad nested enum')
      console.log('ok')
    `
    const scriptPath = join(outDir, 'probe.ts')
    await writeFile(scriptPath, script, 'utf-8')
    const { stdout } = await runNode([...stripTypesArgs, scriptPath])
    expect(stdout).toContain('ok')
  })

  it('rejects --import-ext ts combined with --build', async () => {
    const caseDir = join(workDir, 'import-ext-conflict')
    await mkdir(caseDir, { recursive: true })
    const schemaPath = join(caseDir, 'schema.json')
    await writeFile(schemaPath, JSON.stringify(PLAN_SCHEMA), 'utf-8')

    await expect(
      runNode([CLI_BIN, '--schema', schemaPath, '--outDir', join(caseDir, 'out'), '--import-ext', 'ts', '--build']),
    ).rejects.toThrow(/cannot be combined with --build/)
  })

  // The 0.7.15 corruption shipped because nothing ever exercised the *packed*
  // artifact. Pack every workspace package the way release:publish does —
  // resolve workspace:/catalog: protocols from the real package.json versions
  // (NOT `bun pm pack`, which trusts bun.lock's recorded workspace versions
  // and those go stale after changeset version bumps), then `npm pack` —
  // install into a scratch consumer project, and run the CLI from
  // node_modules. Catches broken files[] lists, exports maps, unresolved
  // protocols, and pack-time corruption.
  it('installs packed tarballs and runs the CLI like an npm consumer', async () => {
    const packDir = join(workDir, 'consumer-tarballs')
    const consumerDir = join(workDir, 'consumer-app')
    await mkdir(packDir, { recursive: true })
    await mkdir(consumerDir, { recursive: true })

    const rootPkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8')) as PackageJson
    const packagesDir = join(ROOT, 'packages')
    const workspacePackages: { dir: string; pkg: PackageJson }[] = []
    const versions = new Map<string, string>()
    for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(packagesDir, entry.name)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8')) as PackageJson
      if (pkg.name && pkg.version) versions.set(pkg.name, pkg.version)
      workspacePackages.push({ dir, pkg })
    }

    // Pack from a copy so resolving protocols never mutates the repo — the
    // same in-place rewrite resolve-workspace-protocol.ts performs in the
    // ephemeral publish job.
    const dependencies: Record<string, string> = {}
    for (const { dir, pkg } of workspacePackages) {
      if (pkg.private || !pkg.name) continue
      const copyDir = join(workDir, 'pack-src', pkg.name.replace('/', '__'))
      await cp(dir, copyDir, { recursive: true, filter: (source) => !source.includes('node_modules') })
      resolveProtocols(pkg, versions, rootPkg)
      await writeFile(join(copyDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8')
      const { stdout } = await runCommand('npm', ['pack', '--pack-destination', packDir], { cwd: copyDir })
      const tarball = stdout.trim().split('\n').at(-1) ?? ''
      dependencies[pkg.name] = `file:${join(packDir, tarball)}`
    }
    expect(Object.keys(dependencies)).toContain('@amritk/mjst')

    // overrides force every transitive @amritk/* edge onto our tarballs —
    // without them the installer happily takes the same version from the npm
    // registry (which is exactly how a corrupted published artifact would
    // sneak back into this test unnoticed).
    await writeFile(
      join(consumerDir, 'package.json'),
      JSON.stringify({
        name: 'mjst-consumer',
        private: true,
        type: 'module',
        dependencies,
        overrides: dependencies,
      }),
      'utf-8',
    )
    await runCommand('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: consumerDir })

    const consumerCli = join(consumerDir, 'node_modules/@amritk/mjst/dist/cli.js')
    const { stdout: version } = await runNode([consumerCli, '--version'])
    expect(version.trim()).toMatch(/^\d+\.\d+\.\d+/)

    const schemaPath = join(consumerDir, 'schema.json')
    await writeFile(schemaPath, JSON.stringify(PLAN_SCHEMA), 'utf-8')
    const outDir = join(consumerDir, 'out')
    await runNode(
      [consumerCli, '--schema', schemaPath, '--outDir', outDir, '--helpers', 'embedded', '--strict', '--build'],
      { cwd: ROOT },
    )
    const probes = await runProbes(join(outDir, 'index.js'), {
      valid: "m.parsePlan({ axiom: { kind: 'assume' } })",
      badKind: "m.parsePlan({ axiom: { kind: 'nonsense' } })",
    })

    expect(probes.valid?.ok).toBe(true)
    expect(probes.badKind?.ok).toBe(false)
  })
})
