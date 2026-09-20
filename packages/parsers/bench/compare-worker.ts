/**
 * One isolated measurement: one mode, reached one way. The orchestrator spawns a
 * fresh process per (mode, way) pair so neither way's JIT state or GC can touch
 * the other's — the same methodology the other benches in this repo use.
 *
 *   usage: bun bench/compare-worker.ts <modeId> <wayId>
 */
import { MODE_CASES, type ModeId } from './cases.ts'
import { generateWay, load, type WayId } from './engines.ts'
import { measure, type Stats } from './measure.ts'

export type WorkerResult = { good: Stats; bad: Stats }

const [modeId, wayId] = process.argv.slice(2) as [ModeId, WayId]

const modeCase = MODE_CASES.find((candidate) => candidate.id === modeId)
if (!modeCase) throw new Error(`unknown mode: ${modeId}`)

const fn = await load(await generateWay(wayId, modeId), modeCase.entry)

// `parseStrict` throws on anything invalid, so its two samples are both the good
// document; timing a throw measures the engine's stack unwinding, not its checks.
const call = (input: unknown): unknown => {
  try {
    return fn(input)
  } catch {
    return false
  }
}

const pool = (sample: unknown): unknown[] => Array.from({ length: 32 }, () => structuredClone(sample))

const result: WorkerResult = {
  good: measure(call, pool(modeCase.good)),
  bad: measure(call, pool(modeCase.bad)),
}

process.stdout.write(JSON.stringify(result))
