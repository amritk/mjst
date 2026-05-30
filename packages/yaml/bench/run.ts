import { gzipSync } from 'node:zlib'
import jsyaml from 'js-yaml'
import { parse as eemeli, parseDocument as eemeliDoc } from 'yaml'

import { parse as ours, parseDocument as oursDoc } from '../src/index'
import { FIXTURES } from './fixtures'

/**
 * Compares `@amritk/yaml` against the two most-used web YAML parsers — `yaml`
 * (eemeli) and `js-yaml` — on the axes the package promises to win: parse
 * throughput and shipped bundle size.
 *
 * We report two throughput tables, because a fair comparison depends on what
 * you ask each parser to produce:
 *
 *  1. Source-mapped tree — the job this package exists for. Every node carries
 *     an exact `[start, end)` range. Only `yaml` (eemeli) also does this;
 *     `js-yaml` has no concept of source positions, so it cannot compete here.
 *  2. Plain data — parse straight to a JavaScript value. All three can do this.
 *
 *   bun run bench
 */

/** Measures throughput in ops/sec after a warmup so we time steady state. */
const throughput = (fn: () => void, budgetMs = 800): number => {
  const warmupEnd = performance.now() + 150
  while (performance.now() < warmupEnd) fn()
  let ops = 0
  const start = performance.now()
  const end = start + budgetMs
  do {
    for (let i = 0; i < 20; i++) fn()
    ops += 20
  } while (performance.now() < end)
  return ops / ((performance.now() - start) / 1000)
}

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

console.log('\n=== 1. Parse to source-mapped tree (ops/sec, higher is better) ===')
console.log('    The diagnostics use case: every node resolves to an exact line:column.\n')
console.log(['fixture', '@amritk/yaml', 'yaml', 'js-yaml', 'speedup vs yaml'].join('\t'))
for (const [name, src] of Object.entries(FIXTURES)) {
  const mine = throughput(() => oursDoc(src))
  const ee = throughput(() => eemeliDoc(src))
  console.log(
    [`${name} (${src.length}B)`, fmt(mine), fmt(ee), 'n/a — no positions', `${(mine / ee).toFixed(1)}x`].join('\t'),
  )
}

console.log('\n=== 2. Parse to plain data (ops/sec, higher is better) ===\n')
console.log(['fixture', '@amritk/yaml', 'yaml', 'js-yaml', 'vs yaml', 'vs js-yaml'].join('\t'))
for (const [name, src] of Object.entries(FIXTURES)) {
  const mine = throughput(() => ours(src))
  const ee = throughput(() => eemeli(src))
  const js = throughput(() => jsyaml.load(src))
  console.log(
    [
      `${name} (${src.length}B)`,
      fmt(mine),
      fmt(ee),
      fmt(js),
      `${(mine / ee).toFixed(1)}x`,
      `${(mine / js).toFixed(2)}x`,
    ].join('\t'),
  )
}

console.log('\n=== 3. Bundle size (minified + gzipped, smaller is better) ===\n')

const bundleSize = async (entry: string): Promise<number> => {
  const built = await Bun.build({ entrypoints: [entry], minify: true, target: 'node' })
  const code = await built.outputs[0]?.text()
  return code ? gzipSync(code).length : 0
}

const entries: Record<string, string> = {
  '@amritk/yaml': new URL('../src/index.ts', import.meta.url).pathname,
  yaml: 'yaml',
  'js-yaml': 'js-yaml',
}
const sizes: Record<string, number> = {}
for (const [name, entry] of Object.entries(entries)) {
  try {
    sizes[name] = await bundleSize(entry)
  } catch (err) {
    console.log(`  (could not bundle ${name}: ${(err as Error).message})`)
  }
}
const mineSize = sizes['@amritk/yaml'] ?? 0
for (const [name, size] of Object.entries(sizes)) {
  const ratio = name === '@amritk/yaml' ? '' : `\t${(size / mineSize).toFixed(1)}x larger`
  console.log(`${name}\t${(size / 1024).toFixed(1)} KB${ratio}`)
}
console.log('')
