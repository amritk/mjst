import { getByPointer } from '../src/get-by-pointer'
import { resolveRefs } from '../src/resolve-refs'
import { REF_BENCH_CASES } from './schemas'

/**
 * Benchmarks the internal `$ref` resolution *strategy*.
 *
 * The production resolver (`resolveRefs`) is single-pass: every unique ref
 * string is resolved exactly once and memoized, with a sentinel that breaks
 * cycles. To show what that strategy buys, we compare it against a naive
 * inliner that re-resolves each ref every time it is encountered (the obvious
 * recursive implementation, with only an on-path guard so cyclic schemas still
 * terminate). Both produce the same inlined shape — the only difference is
 * memoization — so the gap is the value of the cache.
 *
 *   bun run bench
 */

/**
 * Naive resolver: inlines internal refs with no cross-call memoization. `seen`
 * tracks the refs currently on the resolution path so a cycle keeps the
 * reference node in place — the `$ref` verbatim, siblings resolved — exactly as
 * `resolveRefs` does (it no longer collapses cycles to `{}`), instead of
 * recursing forever; shared, non-cyclic refs are re-walked on every occurrence.
 */
const naiveResolve = (node: unknown, root: unknown, seen: Set<string>): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((item) => naiveResolve(item, root, seen))

  const obj = node as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    const ref = obj['$ref']
    if (!ref.startsWith('#')) return obj
    if (seen.has(ref)) {
      // Cycle: keep the reference node, resolving any siblings but leaving the
      // `$ref` verbatim, matching `resolveRefs`'s cycle branch.
      const kept: Record<string, unknown> = {}
      for (const key of Object.keys(obj)) {
        kept[key] = key === '$ref' ? obj[key] : naiveResolve(obj[key], root, seen)
      }
      return kept
    }
    seen.add(ref)
    const resolved = naiveResolve(getByPointer(root, ref.slice(1)), root, seen)
    seen.delete(ref)
    return resolved
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    result[key] = naiveResolve(obj[key], root, seen)
  }
  return result
}

/** Runs `fn` for ~`budgetMs` after a short warmup and returns operations/sec. */
const throughput = (fn: () => void, budgetMs = 600): number => {
  const warmupEnd = performance.now() + 100
  while (performance.now() < warmupEnd) fn()

  let ops = 0
  const start = performance.now()
  const end = start + budgetMs
  do {
    for (let i = 0; i < 200; i++) fn()
    ops += 200
  } while (performance.now() < end)
  return ops / ((performance.now() - start) / 1000)
}

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

console.log('\n=== @amritk/resolve-refs — internal $ref resolution strategy ===\n')
console.log('Node/Bun:', process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`)
console.log('cached = single-pass memoized resolveRefs   naive = re-resolve every ref\n')

console.log(
  `  ${pad('schema', 32)}${padStart('cached ops/s', 16)}${padStart('naive ops/s', 16)}${padStart('speedup', 12)}${padStart('origins +%', 14)}`,
)

for (const testCase of REF_BENCH_CASES) {
  // Parity: both strategies must inline to the same shape before we time them.
  const cached = JSON.stringify(resolveRefs(testCase.schema).resolved)
  const naive = JSON.stringify(naiveResolve(testCase.schema, testCase.schema, new Set()))
  const parity = cached === naive ? '' : '  (MISMATCH!)'

  const cachedOps = throughput(() => void resolveRefs(testCase.schema))
  const naiveOps = throughput(() => void naiveResolve(testCase.schema, testCase.schema, new Set()))
  const originsOps = throughput(() => void resolveRefs(testCase.schema, { trackOrigins: true }))
  const originsOverhead = ((cachedOps / originsOps - 1) * 100).toFixed(0)

  console.log(
    `  ${pad(testCase.name, 32)}${padStart(fmt(cachedOps), 16)}${padStart(fmt(naiveOps), 16)}${padStart(`${(cachedOps / naiveOps).toFixed(2)}x`, 12)}${padStart(`+${originsOverhead}%`, 14)}${parity}`,
  )
}

console.log('\n  speedup > 1 means the cache wins; origins +% is the cost of trackOrigins.\n')
