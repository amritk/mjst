import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildValidatorSchema } from '../../src/validators/index.ts'
import { measure, opsCell } from './measure.ts'
import { BENCH_CASES } from './schemas.ts'

/**
 * What the fail-fast half is for, measured.
 *
 * `isX` is the cheap answer and `validateX` is the complete one, and the gap
 * between them on invalid input is enormous — `isX` stops at the first thing
 * wrong and allocates nothing, `validateX` walks the whole document building an
 * error object per violation. `checkX` is meant to sit where most callers
 * actually are: they need to say *what* was wrong, but only the first thing.
 *
 * Three input shapes, because they separate the two effects:
 *
 *   - **valid** — nothing short-circuits, so this is the price of carrying the
 *     third function at all. It should be a wash.
 *   - **first field wrong** — the maximum short circuit: one check runs, one
 *     error object is built, and everything else is skipped.
 *   - **everything wrong** — the honest middle. `validateX` reports every
 *     violation; `checkX` still reports one, so the saving is whatever the rest
 *     of the document would have cost.
 *
 * Timed with the shared `measure()` the rest of the repo's benches use, so these
 * numbers sit on the same statistics (median of many short trials, inputs cycled
 * from a pool so nothing is hoisted or eliminated).
 */

/** The three verdict functions one generated file exports, as plain callables. */
type Half = (input: unknown) => unknown

const POOL = 16

/**
 * Distinct object identities for the timed loop. One frozen literal would let
 * the engine cache far more than a real workload allows — see the note in
 * `measure.ts`.
 */
const poolOf = (value: unknown): readonly unknown[] =>
  Array.from({ length: POOL }, () => JSON.parse(JSON.stringify(value)))

const load = async (
  schema: Parameters<typeof buildValidatorSchema>[0],
  typeName: string,
): Promise<{ validate: Half; check: Half; guard: Half }> => {
  const files = await buildValidatorSchema(
    schema,
    typeName,
    '',
    undefined,
    undefined,
    undefined,
    false,
    false,
    false,
    'js',
    true,
  )
  const dir = mkdtempSync(join(tmpdir(), 'mjst-check-bench-'))
  // Bun resolves a `./x.js` specifier back to the `./x.ts` on disk, but Node's
  // type stripping does not, so the emitted specifiers are pointed at the files
  // actually written — the same rewrite `validators.ts` does.
  for (const file of files) {
    writeFileSync(join(dir, file.filename), file.content.replace(/(from '\.[^']*)\.js'/g, "$1.ts'"))
  }
  const module = await import(pathToFileURL(join(dir, 'index.ts')).href)
  rmSync(dir, { recursive: true, force: true })

  return {
    validate: module[`validate${typeName}`] as Half,
    check: module[`check${typeName}`] as Half,
    guard: module[`is${typeName}`] as Half,
  }
}

const pad = (text: string, width: number): string => text.padEnd(width)

/**
 * A value of a different kind to the one given, so the position fails its `type`
 * check. Flipping the kind rather than the value is what makes this work for any
 * case in the corpus without knowing its schema.
 */
const wrongKind = (value: unknown): unknown => (typeof value === 'string' ? 42 : 'wrong')

/** The same document with only its first property spoiled, and with all of them. */
const spoiled = (valid: Record<string, unknown>, all: boolean): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...valid }
  for (const key of all ? Object.keys(valid) : Object.keys(valid).slice(0, 1)) out[key] = wrongKind(valid[key])
  return out
}

const report = async (benchCase: (typeof BENCH_CASES)[number]): Promise<void> => {
  const { validate, check, guard } = await load(benchCase.schema, benchCase.typeName)
  const valid = benchCase.valid as Record<string, unknown>

  const inputs: ReadonlyArray<readonly [string, unknown]> = [
    ['valid', valid],
    ['first field wrong', spoiled(valid, false)],
    ['everything wrong', spoiled(valid, true)],
  ]

  console.log(`\n${benchCase.name} — throughput, ops/sec (median, ±spread)\n`)
  console.log(`${pad('input', 20)}${pad('validateX', 20)}${pad('checkX', 20)}${pad('isX', 20)}checkX vs validateX`)
  console.log('-'.repeat(96))

  for (const [label, value] of inputs) {
    const pool = poolOf(value)
    const validated = measure(validate, pool)
    const checked = measure(check, pool)
    const guarded = measure(guard, pool)
    const ratio = validated.median > 0 ? checked.median / validated.median : 0
    console.log(
      `${pad(label, 20)}${pad(opsCell(validated.median, validated.spread), 20)}` +
        `${pad(opsCell(checked.median, checked.spread), 20)}` +
        `${pad(opsCell(guarded.median, guarded.spread), 20)}${ratio.toFixed(2)}x`,
    )
  }
}

// The flat contract and the nested one, because the saving is whatever the rest
// of the document would have cost — which is nearly nothing for four scalars and
// a great deal for an order with a customer and a line-item array.
const CASE_NAMES = ['small (4 fields)', 'order (nested + array)'] as const

for (const name of CASE_NAMES) {
  const benchCase = BENCH_CASES.find((candidate) => candidate.name === name)
  if (benchCase === undefined) throw new Error(`no bench case named "${name}"`)
  await report(benchCase)
}
console.log()
