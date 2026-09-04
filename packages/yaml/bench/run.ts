import { unlink } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { parse as ours, parseDocument as oursDoc } from '@amritk/yaml'
import jsyaml from 'js-yaml'
import { parse as eemeli, parseDocument as eemeliDoc } from 'yaml'

import { FIXTURES } from './fixtures.ts'

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

console.log('\n=== 3. Bundle size (minified + gzipped, smaller is better) ===')
console.log('    What each parser adds to an app that parses to data *and* to a positioned tree.\n')

/**
 * Bundles a generated *consumer* of a parser, not the parser's own entry point.
 *
 * Pointing `Bun.build` straight at `src/index.ts` measured nothing: the barrel
 * is pure re-exports and the package declares `sideEffects: false`, so the whole
 * parser tree-shook away and the bench proudly reported `0.1 KB` for us and
 * `294x larger` for `yaml` — a number that would have gone into the README. The
 * entry below references every import it names, which is what forces the
 * bundler to actually pull the implementation in.
 *
 * The entry has to live inside the package so bare specifiers (`yaml`,
 * `js-yaml`) resolve against its `node_modules`, hence the write-and-delete.
 */
const bundleSize = async (specifier: string, named: readonly string[]): Promise<number> => {
  const entry = new URL(`./.bundle-probe-${named[0]}-${Math.random().toString(36).slice(2)}.ts`, import.meta.url)
  const imports = named.join(', ')
  await Bun.write(entry, `import { ${imports} } from '${specifier}'\nexport const used = [${imports}]\n`)
  try {
    const built = await Bun.build({ entrypoints: [entry.pathname], minify: true, target: 'node' })
    const code = await built.outputs[0]?.text()
    return code ? gzipSync(code).length : 0
  } finally {
    await unlink(entry)
  }
}

/**
 * The API surface a real consumer imports. `js-yaml` has no positioned-tree
 * equivalent, so it only gets `load` — which is exactly why its bundle is
 * smaller than it looks: it is not doing the same job.
 */
const entries: Record<string, [specifier: string, named: readonly string[]]> = {
  '@amritk/yaml': ['@amritk/yaml', ['parse', 'parseDocument', 'nodeAtPath', 'lineCounter']],
  yaml: ['yaml', ['parse', 'parseDocument']],
  'js-yaml': ['js-yaml', ['load']],
}
// Bundle size is a property of the code, not of the runtime executing it, so
// it is measured once — under Bun, whose bundler does the work. A Node run of
// this bench reports the throughput tables and says why this section is absent
// rather than printing a size it did not measure.
const sizes: Record<string, number> = {}
if (typeof Bun === 'undefined') {
  console.log('  (skipped under Node: the size probe bundles with Bun — run `bun run bench` for this table)\n')
} else {
  for (const [name, [specifier, named]] of Object.entries(entries)) {
    try {
      sizes[name] = await bundleSize(specifier, named)
    } catch (err) {
      console.log(`  (could not bundle ${name}: ${(err as Error).message})`)
    }
  }
}
const mineSize = sizes['@amritk/yaml'] ?? 0
for (const [name, size] of Object.entries(sizes)) {
  const ratio = name === '@amritk/yaml' ? '' : `\t${(size / mineSize).toFixed(1)}x larger`
  console.log(`${name}\t${(size / 1024).toFixed(1)} KB${ratio}`)
}
console.log('')
