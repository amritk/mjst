import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { validate, validateGuard } from '../src/index.ts'
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

/**
 * Times the cold cost of going from a freshly-cloned schema to a *ready* result
 * — for us, building the validator and running it once; for Ajv, compiling and
 * running once. This is the one-shot CLI path where each schema is used once.
 */
const coldRunMs = (coldRun: (schema: Record<string, unknown>) => void, schema: Record<string, unknown>): number => {
  const iterations = 200
  // Warmup.
  for (let i = 0; i < 20; i++) coldRun(structuredClone(schema))

  const clones = Array.from({ length: iterations }, () => structuredClone(schema))
  const start = performance.now()
  for (let i = 0; i < iterations; i++) coldRun(clones[i] as Record<string, unknown>)
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
  const mjstGuard = validateGuard(testCase.schema)
  const mjstFull = validate(testCase.schema)

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
      'mjst validate',
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

  // Cold one-shot cost: time from a schema to a ready *result*. The interpreter
  // has no compile step, so this is essentially the cost of a single walk; Ajv
  // must compile the schema first. This is the common CLI path — validate one
  // example per schema in a fresh process — and where the interpreter wins big.
  const mjstColdMs = coldRunMs((schema) => void validate(schema)(testCase.valid), testCase.schema)
  const mjstGuardColdMs = coldRunMs((schema) => void validateGuard(schema)(testCase.valid), testCase.schema)
  const ajvColdMs = coldRunMs((schema) => {
    const ajv = makeAjv(false)
    ajv.compile(schema)(testCase.valid)
  }, testCase.schema)

  console.log(`\n  cold one-shot cost per schema (schema → first result):`)
  console.log(`    ${pad('mjst validate', 18)}${padStart(`${mjstColdMs.toFixed(4)} ms`, 14)}`)
  console.log(`    ${pad('mjst guard', 18)}${padStart(`${mjstGuardColdMs.toFixed(4)} ms`, 14)}`)
  console.log(
    `    ${pad('ajv', 18)}${padStart(`${ajvColdMs.toFixed(4)} ms`, 14)}  (${(ajvColdMs / mjstColdMs).toFixed(1)}x mjst)`,
  )
}

console.log('')
