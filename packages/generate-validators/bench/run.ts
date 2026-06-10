import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import type { ValidateFunction } from 'ajv'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { buildValidatorSchema } from '../src/index.ts'
import { BENCH_CASES, type BenchCase } from './schemas.ts'

/**
 * Compares the four ways a JSON Schema becomes a runtime check:
 *
 *   - **mjst** generates standalone TypeScript validator source ahead of time
 *     (`@amritk/generate-validators`); here we generate it, load it, and run it.
 *   - **Ajv** compiles the schema to a function at startup.
 *   - **TypeBox** compiles its schema to a checker at startup (`TypeCompiler`).
 *   - **Zod** is authored as code directly (no schema-compilation step).
 *
 * We report steady-state throughput (validator already prepared) and the cold
 * "prepare a validator" cost — codegen for mjst, compile for Ajv and TypeBox.
 */

/** Runs `fn` for ~`budgetMs` after a short warmup and returns operations/sec. */
const throughput = (fn: () => void, budgetMs = 600): number => {
  const warmupEnd = performance.now() + 100
  while (performance.now() < warmupEnd) fn()

  let ops = 0
  const start = performance.now()
  const end = start + budgetMs
  do {
    for (let i = 0; i < 1000; i++) fn()
    ops += 1000
  } while (performance.now() < end)
  const elapsed = performance.now() - start

  return ops / (elapsed / 1000)
}

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

const makeAjv = (): Ajv => {
  const ajv = new Ajv({ strict: false })
  addFormats(ajv)
  return ajv
}

/** A validator that returns a plain boolean, normalising each library's verdict. */
type BoolValidator = (input: unknown) => boolean

/**
 * Generates mjst validator source for `case`, writes the files to a temp dir,
 * and dynamically imports the exported `validate<TypeName>`. The generated code
 * only imports its sibling `./validation-result`, so a temp dir resolves cleanly.
 */
const loadMjstValidator = async (benchCase: BenchCase): Promise<BoolValidator> => {
  const files = await buildValidatorSchema(benchCase.schema, benchCase.typeName)
  const dir = mkdtempSync(join(tmpdir(), 'mjst-bench-'))
  for (const file of files) writeFileSync(join(dir, file.filename), file.content)

  const mod = await import(pathToFileURL(join(dir, 'index.ts')).href)
  rmSync(dir, { recursive: true, force: true })

  const validate = mod[`validate${benchCase.typeName}`] as (input: unknown, path?: string) => unknown
  return (input) => validate(input) === true
}

/** Times the cold cost of producing a ready-to-run validator, averaged over runs. */
const prepareMs = async (prepare: () => unknown | Promise<unknown>, iterations = 50): Promise<number> => {
  for (let i = 0; i < 5; i++) await prepare()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await prepare()
  return (performance.now() - start) / iterations
}

const run = async (): Promise<void> => {
  console.log('\n=== @amritk/generate-validators vs ajv vs zod ===\n')
  console.log(`Node/Bun: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : process.version}\n`)

  for (const benchCase of BENCH_CASES) {
    console.log(`## ${benchCase.name}\n`)

    const mjst = await loadMjstValidator(benchCase)
    const ajv = makeAjv()
    const ajvValidate = ajv.compile(benchCase.schema as object) as ValidateFunction
    const typebox = TypeCompiler.Compile(benchCase.typebox)
    const zod = benchCase.zod

    const validators: Array<[string, BoolValidator]> = [
      ['mjst (generated)', mjst],
      ['ajv (compiled)', (input) => ajvValidate(input) === true],
      ['typebox (compiled)', (input) => typebox.Check(input)],
      ['zod', (input) => zod.safeParse(input).success],
    ]

    // Parity: every library must agree the valid sample passes and the invalid
    // one(s) fail. A disagreement makes the throughput numbers meaningless, so
    // assert it before timing and fail loudly rather than report a mirage.
    for (const [label, fn] of validators) {
      if (fn(benchCase.valid) !== true) throw new Error(`${benchCase.name}: ${label} rejected the valid sample`)
      if (fn(benchCase.invalid) !== false) throw new Error(`${benchCase.name}: ${label} accepted the invalid sample`)
      for (const sample of benchCase.extraInvalid ?? []) {
        if (fn(sample) !== false) throw new Error(`${benchCase.name}: ${label} accepted an extra-invalid sample`)
      }
    }
    const parity = validators
      .map(([label, fn]) => `${label}=${fn(benchCase.valid)}/${fn(benchCase.invalid)}`)
      .join('  ')
    console.log(`  parity (valid/invalid): ${parity}\n`)

    console.log(`  ${pad('validator', 20)}${padStart('valid ops/s', 16)}${padStart('invalid ops/s', 16)}`)
    for (const [label, fn] of validators) {
      const valid = throughput(() => fn(benchCase.valid))
      const invalid = throughput(() => fn(benchCase.invalid))
      console.log(`  ${pad(label, 20)}${padStart(fmt(valid), 16)}${padStart(fmt(invalid), 16)}`)
    }

    // Cold "prepare a validator" cost.
    const mjstGen = await prepareMs(() => buildValidatorSchema(benchCase.schema, benchCase.typeName))
    const ajvCompile = await prepareMs(() => makeAjv().compile(benchCase.schema as object))
    const typeboxCompile = await prepareMs(() => TypeCompiler.Compile(benchCase.typebox))
    console.log('\n  prepare-a-validator cost (one-shot):')
    console.log(`    mjst codegen (source)   ${mjstGen.toFixed(3)} ms`)
    console.log(`    ajv compile             ${ajvCompile.toFixed(3)} ms`)
    console.log(`    typebox compile         ${typeboxCompile.toFixed(3)} ms`)
    console.log('    zod authoring           n/a (no build step)')
    console.log('')
  }
}

await run()
