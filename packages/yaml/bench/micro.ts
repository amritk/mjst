/**
 * High-sensitivity micro-benchmark for our parser alone. Reports median ns/op
 * across several trials so small (<3%) deltas are visible while iterating on
 * parser internals. Not shipped as the public bench — `run.ts` stays the
 * comparison surface; this is a development probe.
 *
 *   bun run ./bench/micro.ts
 */
import { parse, parseDocument } from '../src/index'
import { FIXTURES } from './fixtures'

const measure = (fn: () => void, iters: number): number => {
  // Warmup.
  for (let i = 0; i < iters; i++) fn()
  const trials: number[] = []
  for (let t = 0; t < 9; t++) {
    const start = performance.now()
    for (let i = 0; i < iters; i++) fn()
    trials.push((performance.now() - start) / iters)
  }
  trials.sort((a, b) => a - b)
  return trials[Math.floor(trials.length / 2)] ?? 0
}

const itersFor: Record<string, number> = { small: 20000, medium: 4000, large: 200 }

console.log('fixture\ttree ms/op\tdata ms/op')
for (const [name, src] of Object.entries(FIXTURES)) {
  const iters = itersFor[name] ?? 1000
  const tree = measure(() => parseDocument(src), iters)
  const data = measure(() => parse(src), iters)
  console.log(`${name}\t${tree.toFixed(5)}\t${data.toFixed(5)}`)
}
