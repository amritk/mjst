import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { compile, compileGuard } from '../src/index.ts'
import { BENCH_CASES } from './schemas.ts'

/**
 * Runs `fn` for roughly `budgetMs` and returns operations per second. A short
 * warmup lets V8 tier the code up before we start timing, so we measure steady
 * state rather than the interpreter.
 */
const throughput = (fn: () => void, budgetMs = 600): number => {
  // Warmup.
  const warmupEnd = performance.now() + 100
  while (performance.now() < warmupEnd) fn()

  let ops = 0
  const start = performance.now()
  const end = start + budgetMs
  // Batch to amortize the clock read.
  do {
    for (let i = 0; i < 1000; i++) fn()
    ops += 1000
  } while (performance.now() < end)
  const elapsed = performance.now() - start

  return ops / (elapsed / 1000)
}

/** Times how long it takes to compile a freshly-cloned schema, averaged. */
const compileTimeMs = (
  compileOnce: (schema: Record<string, unknown>) => void,
  schema: Record<string, unknown>,
): number => {
  const iterations = 200
  // Warmup.
  for (let i = 0; i < 20; i++) compileOnce(structuredClone(schema))

  const clones = Array.from({ length: iterations }, () => structuredClone(schema))
  const start = performance.now()
  for (let i = 0; i < iterations; i++) compileOnce(clones[i] as Record<string, unknown>)
  return (performance.now() - start) / iterations
}

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

const makeAjv = (allErrors: boolean): Ajv => {
  const ajv = new Ajv({ allErrors, strict: false })
  addFormats(ajv)
  return ajv
}

console.log('\n=== @amritk/runtime-validators vs ajv ===\n')
console.log('Node/Bun:', process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`)

for (const testCase of BENCH_CASES) {
  console.log(`\n## ${testCase.name}\n`)

  // Build validators once for the throughput phase.
  const mjstGuard = compileGuard(testCase.schema)
  const mjstFull = compile(testCase.schema)

  const ajvFirst = makeAjv(false).compile(testCase.schema)
  // A second Ajv instance is needed for the all-errors variant because the
  // schema $id can only be registered once per instance.
  const ajvAll = makeAjv(true).compile(structuredClone(testCase.schema))

  // Correctness parity check before timing — a fast wrong answer is worthless.
  const mjstValidOk = mjstFull(testCase.valid) === true
  const mjstInvalidOk = mjstFull(testCase.invalid) !== true
  const ajvValidOk = ajvFirst(testCase.valid) === true
  const ajvInvalidOk = ajvFirst(testCase.invalid) === false
  const guardValidOk = mjstGuard(testCase.valid) === true
  const guardInvalidOk = mjstGuard(testCase.invalid) === false
  const parity = mjstValidOk && mjstInvalidOk && ajvValidOk && ajvInvalidOk && guardValidOk && guardInvalidOk
  console.log(
    `  parity: ${parity ? 'OK' : 'MISMATCH'} (mjst v/i ${mjstValidOk}/${mjstInvalidOk}, guard ${guardValidOk}/${guardInvalidOk}, ajv ${ajvValidOk}/${ajvInvalidOk})\n`,
  )

  const rows: Array<[string, number, number]> = [
    [
      'mjst guard',
      throughput(() => void mjstGuard(testCase.valid)),
      throughput(() => void mjstGuard(testCase.invalid)),
    ],
    [
      'mjst compile',
      throughput(() => void mjstFull(testCase.valid)),
      throughput(() => void mjstFull(testCase.invalid)),
    ],
    [
      'ajv (first err)',
      throughput(() => void ajvFirst(testCase.valid)),
      throughput(() => void ajvFirst(testCase.invalid)),
    ],
    [
      'ajv (all errors)',
      throughput(() => void ajvAll(testCase.valid)),
      throughput(() => void ajvAll(testCase.invalid)),
    ],
  ]

  const baselineValid = rows.find((r) => r[0] === 'ajv (first err)')?.[1] ?? 1
  console.log(
    `  ${pad('validator', 18)}${padStart('valid ops/s', 14)}${padStart('invalid ops/s', 16)}${padStart('vs ajv (valid)', 16)}`,
  )
  for (const [label, validOps, invalidOps] of rows) {
    const ratio = `${(validOps / baselineValid).toFixed(2)}x`
    console.log(
      `  ${pad(label, 18)}${padStart(fmt(validOps), 14)}${padStart(fmt(invalidOps), 16)}${padStart(ratio, 16)}`,
    )
  }

  // Compile (startup) cost: time to a *ready-to-use* validator. Compilation is
  // lazy, so we call the validator once on the valid sample to force the
  // `new Function` JIT — this is the true cost a caller pays before the first
  // successful validation, and the fair comparison against Ajv's eager compile.
  const mjstCompileMs = compileTimeMs((schema) => void compile(schema)(testCase.valid), testCase.schema)
  const mjstGuardCompileMs = compileTimeMs((schema) => void compileGuard(schema)(testCase.valid), testCase.schema)
  const ajvCompileMs = compileTimeMs((schema) => {
    const ajv = makeAjv(false)
    ajv.compile(schema)(testCase.valid)
  }, testCase.schema)

  console.log(`\n  compile (startup) cost per schema:`)
  console.log(`    ${pad('mjst compile', 18)}${padStart(`${mjstCompileMs.toFixed(4)} ms`, 14)}`)
  console.log(`    ${pad('mjst guard', 18)}${padStart(`${mjstGuardCompileMs.toFixed(4)} ms`, 14)}`)
  console.log(
    `    ${pad('ajv', 18)}${padStart(`${ajvCompileMs.toFixed(4)} ms`, 14)}  (${(ajvCompileMs / mjstCompileMs).toFixed(1)}x mjst)`,
  )
}

console.log('')
