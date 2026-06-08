/**
 * Benchmark fixtures for the internal `$ref` resolver.
 *
 * The point of these schemas is to exercise the parts of the resolution
 * *strategy* that actually cost something:
 *
 *  - **reuse-heavy** — one `$def` referenced from dozens of sites. The
 *    single-pass cache resolves it once; a naive inliner re-walks it every
 *    time. This is where memoization earns its keep.
 *  - **chain** — a long `$ref` → `$ref` → … chain. Measures the cost of
 *    following deep indirection.
 *  - **wide-distinct** — many `$def`s each referenced exactly once. The cache
 *    almost never hits here, so this isolates its bookkeeping overhead.
 *  - **cyclic** — a self-referential node (a tree). Exercises the cycle
 *    sentinel; without it the walk would not terminate.
 */

export type RefBenchCase = {
  name: string
  /** Whether the schema contains a `$ref` cycle (the naive baseline still terminates via its path guard). */
  cyclic: boolean
  schema: Record<string, unknown>
}

/**
 * One shared `address` `$def`, referenced from `count` properties (and again
 * from a nested array of objects). Every reference points at the same pointer,
 * so a cache resolves it once and reuses the result count-plus times.
 */
const reuseHeavy = (count: number): Record<string, unknown> => {
  const properties: Record<string, unknown> = {}
  for (let i = 0; i < count; i++) {
    properties[`addr_${i}`] = { $ref: '#/$defs/address' }
  }
  properties['contacts'] = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        home: { $ref: '#/$defs/address' },
        work: { $ref: '#/$defs/address' },
      },
    },
  }
  return {
    type: 'object',
    properties,
    $defs: {
      address: {
        type: 'object',
        required: ['street', 'city', 'zip'],
        properties: {
          street: { type: 'string', minLength: 1 },
          city: { type: 'string', minLength: 1 },
          zip: { type: 'string', pattern: '^[0-9]{5}$' },
          country: { type: 'string', minLength: 2, maxLength: 2 },
        },
      },
    },
  }
}

/** A `$ref` chain `step_0` → `step_1` → … → a concrete leaf, `length` links deep. */
const chain = (length: number): Record<string, unknown> => {
  const defs: Record<string, unknown> = {}
  for (let i = 0; i < length; i++) {
    defs[`step_${i}`] = i === length - 1 ? { type: 'string', minLength: 1 } : { $ref: `#/$defs/step_${i + 1}` }
  }
  return {
    type: 'object',
    properties: { head: { $ref: '#/$defs/step_0' } },
    $defs: defs,
  }
}

/** `count` distinct `$def`s, each referenced exactly once — a low cache-hit shape. */
const wideDistinct = (count: number): Record<string, unknown> => {
  const properties: Record<string, unknown> = {}
  const defs: Record<string, unknown> = {}
  for (let i = 0; i < count; i++) {
    properties[`field_${i}`] = { $ref: `#/$defs/def_${i}` }
    defs[`def_${i}`] = {
      type: 'object',
      properties: {
        value: { type: i % 2 === 0 ? 'string' : 'integer' },
        label: { type: 'string' },
      },
    }
  }
  return { type: 'object', properties, $defs: defs }
}

/** A recursive tree node: each node's children reference the node itself. */
const cyclicTree = (): Record<string, unknown> => ({
  type: 'object',
  properties: { root: { $ref: '#/$defs/node' } },
  $defs: {
    node: {
      type: 'object',
      required: ['value'],
      properties: {
        value: { type: 'string' },
        parent: { $ref: '#/$defs/node' },
        children: {
          type: 'array',
          items: { $ref: '#/$defs/node' },
        },
      },
    },
  },
})

export const REF_BENCH_CASES: readonly RefBenchCase[] = [
  { name: 'reuse-heavy (50 refs → 1 def)', cyclic: false, schema: reuseHeavy(50) },
  { name: 'chain (40 links)', cyclic: false, schema: chain(40) },
  { name: 'wide-distinct (60 defs)', cyclic: false, schema: wideDistinct(60) },
  { name: 'cyclic tree', cyclic: true, schema: cyclicTree() },
]
