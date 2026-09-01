import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { compileGuard } from '../src/compile/index.ts'
import { validateGuard } from '../src/index.ts'
import { BENCH_CASES } from './schemas.ts'

/**
 * Measures what the opt-in compiled tier (`@amritk/runtime-validators/compile`)
 * buys and what it costs, against the interpreter it is an alternative to and
 * Ajv as the external reference.
 *
 * Two questions, and they pull in opposite directions:
 *
 *   - **Steady state** — one schema, many values. What `compileGuard` is for.
 *   - **Cold one-shot** — a fresh schema, made ready, applied once. The path
 *     this package exists to win, and the one the compile must not wreck.
 *
 * Every case is checked for agreement across all three implementations before it
 * is timed, so a "fast" number can never come from a validator that is simply
 * wrong.
 */
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
  return ops / ((performance.now() - start) / 1000)
}

const coldMs = (run: (schema: Record<string, unknown>) => void, schema: Record<string, unknown>): number => {
  const iterations = 200
  for (let i = 0; i < 20; i++) run(structuredClone(schema))
  const clones = Array.from({ length: iterations }, () => structuredClone(schema))
  const start = performance.now()
  for (let i = 0; i < iterations; i++) run(clones[i] as Record<string, unknown>)
  return (performance.now() - start) / iterations
}

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

const newAjv = (): Ajv => {
  const ajv = new Ajv({ strict: false })
  addFormats(ajv as never)
  return ajv
}

console.log('Steady state — one schema, many values (ops/sec)\n')
console.log('case                 | interpreter | compiled  | ajv       | vs interpreter | vs ajv')
console.log('---------------------|-------------|-----------|-----------|----------------|-------')
for (const benchCase of BENCH_CASES) {
  const interpreted = validateGuard(benchCase.schema as never)
  const compiled = compileGuard(benchCase.schema as never)
  const ajv = newAjv().compile(benchCase.schema as never)

  // Agreement first: a benchmark of a wrong answer measures nothing.
  for (const [value, expected] of [
    [benchCase.valid, true],
    [benchCase.invalid, false],
  ] as const) {
    if (interpreted(value) !== expected || compiled(value) !== expected || ajv(value) !== expected) {
      throw new Error(`implementations disagree on "${benchCase.name}"`)
    }
  }

  const i = throughput(() => {
    interpreted(benchCase.valid)
    interpreted(benchCase.invalid)
  })
  const c = throughput(() => {
    compiled(benchCase.valid)
    compiled(benchCase.invalid)
  })
  const a = throughput(() => {
    ajv(benchCase.valid)
    ajv(benchCase.invalid)
  })
  console.log(
    `${benchCase.name.padEnd(20)} | ${fmt(i).padEnd(11)} | ${fmt(c).padEnd(9)} | ${fmt(a).padEnd(9)} | ${`${(c / i).toFixed(2)}×`.padEnd(14)} | ${(c / a).toFixed(2)}×`,
  )
}

console.log('\nCold one-shot — fresh schema to ready, plus one value (ms)\n')
console.log('case                 | interpreter | compiled  | ajv')
console.log('---------------------|-------------|-----------|----------')
for (const benchCase of BENCH_CASES) {
  const i = coldMs((schema) => {
    validateGuard(schema as never)(benchCase.valid)
  }, benchCase.schema)
  const c = coldMs((schema) => {
    compileGuard(schema as never)(benchCase.valid)
  }, benchCase.schema)
  const a = coldMs((schema) => {
    newAjv().compile(schema as never)(benchCase.valid)
  }, benchCase.schema)
  console.log(`${benchCase.name.padEnd(20)} | ${i.toFixed(4).padEnd(11)} | ${c.toFixed(4).padEnd(9)} | ${a.toFixed(4)}`)
}
