import { buildDynamicRefMap } from '@amritk/helpers/build-dynamic-ref-map'
import { resolveDynamicRefs } from '@amritk/helpers/resolve-dynamic-refs'

import { resolveDynamicRef } from '../src/interpreter/resolve-dynamic-ref.ts'

/**
 * Benchmarks the two strategies for `$dynamicRef` resolution in this repo:
 *
 *   - **build-time rewrite** (`@amritk/helpers`): `buildDynamicRefMap` scans the
 *     top-level `$defs` once for `$dynamicAnchor`s, then `resolveDynamicRefs`
 *     deep-clones the document and rewrites every `{ $dynamicRef: "#meta" }`
 *     into a plain `{ $ref: "#/$defs/…" }`. One map build amortised over the
 *     whole document.
 *   - **runtime DFS** (`resolveDynamicRef`, the interpreter): each `$dynamicRef`
 *     is resolved on demand by depth-first searching the document for the object
 *     carrying the matching `$dynamicAnchor`. We time it both *cold* (search per
 *     occurrence) and *memoized* by ref string (what the interpreter actually
 *     does — search once per unique anchor).
 *
 * The interesting axis is where the anchor sits: a DFS pays for everything it
 * visits before finding the anchor, so we test an anchor as the first `$def`
 * versus buried after many siblings.
 *
 *   bun run bench:dynamic
 */

type DynRefCase = {
  name: string
  /** Number of `$dynamicRef: "#meta"` occurrences scattered through the document. */
  refs: number
  /** Build the document with the `$dynamicAnchor` def first vs. last among many siblings. */
  anchorLast: boolean
  /** Number of unrelated sibling `$defs` the DFS may have to walk past. */
  filler: number
}

/**
 * An OpenAPI-3.1-shaped document: one `$def` carries `$dynamicAnchor: "meta"`,
 * `refs` property schemas late-bind to it via `$dynamicRef: "#meta"`, and
 * `filler` unrelated `$defs` pad the document so the DFS has ground to cover.
 */
const buildDoc = (testCase: DynRefCase): Record<string, unknown> => {
  const metaDef = {
    $dynamicAnchor: 'meta',
    type: 'object',
    properties: {
      name: { type: 'string' },
      value: {},
    },
  }

  const filler: Record<string, unknown> = {}
  for (let i = 0; i < testCase.filler; i++) {
    filler[`filler_${i}`] = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'integer' },
        nested: { type: 'object', properties: { x: { type: 'boolean' } } },
      },
    }
  }

  // Place the anchor-bearing def first or last among the filler siblings so the
  // depth-first search either finds it immediately or only after walking past
  // everything else.
  const defs: Record<string, unknown> = testCase.anchorLast
    ? { ...filler, schema: metaDef }
    : { schema: metaDef, ...filler }

  const properties: Record<string, unknown> = {}
  for (let i = 0; i < testCase.refs; i++) {
    properties[`field_${i}`] = { $dynamicRef: '#meta' }
  }

  return {
    $id: 'https://example.com/dynamic',
    type: 'object',
    properties,
    $defs: defs,
  }
}

/** Walks `node`, invoking `onRef(refString)` for every `$dynamicRef` it finds. */
const forEachDynamicRef = (node: unknown, onRef: (ref: string) => void): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) forEachDynamicRef(item, onRef)
    return
  }
  const obj = node as Record<string, unknown>
  if (typeof obj['$dynamicRef'] === 'string') onRef(obj['$dynamicRef'])
  for (const key in obj) forEachDynamicRef(obj[key], onRef)
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

const CASES: readonly DynRefCase[] = [
  { name: 'anchor first, 10 refs', refs: 10, anchorLast: false, filler: 20 },
  { name: 'anchor last, 10 refs', refs: 10, anchorLast: true, filler: 20 },
  { name: 'anchor last, 50 refs', refs: 50, anchorLast: true, filler: 40 },
]

/** Resolves every `$dynamicRef` in `doc` via the interpreter DFS; memoizes per ref string when asked. */
const interpreterResolveAll = (doc: unknown, memo: boolean): void => {
  const cache = memo ? new Map<string, unknown>() : undefined
  forEachDynamicRef(doc, (ref) => {
    if (cache) {
      if (!cache.has(ref)) cache.set(ref, resolveDynamicRef(ref, doc))
      return
    }
    resolveDynamicRef(ref, doc)
  })
}

console.log('\n=== @amritk/runtime-validators — $dynamicRef resolution strategies ===\n')
console.log('Node/Bun:', process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`)
console.log('Resolving every $dynamicRef in the document, three ways (ops/sec, higher is better).\n')

console.log(
  `  ${pad('case', 26)}${padStart('rewrite (helpers)', 20)}${padStart('DFS cold', 14)}${padStart('DFS memoized', 16)}`,
)

for (const testCase of CASES) {
  const doc = buildDoc(testCase)

  // Parity: each strategy must agree the anchor target resolves to the same
  // object the build-time map points at.
  const map = buildDynamicRefMap(doc)
  const rewritten = resolveDynamicRefs(doc, map) as Record<string, unknown>
  const props = rewritten['properties'] as Record<string, Record<string, unknown>>
  const rewriteTarget = props['field_0']?.['$ref']
  const dfsTarget = resolveDynamicRef('#meta', doc)
  const parity = rewriteTarget === '#/$defs/schema' && dfsTarget !== undefined ? '' : '  (PARITY?)'

  const rewriteOps = throughput(() => void resolveDynamicRefs(doc, buildDynamicRefMap(doc)))
  const dfsColdOps = throughput(() => interpreterResolveAll(doc, false))
  const dfsMemoOps = throughput(() => interpreterResolveAll(doc, true))

  console.log(
    `  ${pad(testCase.name, 26)}${padStart(fmt(rewriteOps), 20)}${padStart(fmt(dfsColdOps), 14)}${padStart(fmt(dfsMemoOps), 16)}${parity}`,
  )
}

console.log(
  '\n  rewrite = buildDynamicRefMap + resolveDynamicRefs (clone+rewrite whole doc)\n  DFS = resolveDynamicRef per occurrence; memoized = once per unique ref string\n',
)
