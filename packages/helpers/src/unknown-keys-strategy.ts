/**
 * How a generated fast path proves that a closed object — `additionalProperties:
 * false` with every declared property required — carries no undeclared key.
 *
 * The typed checks ahead of the test have already proven every declared key
 * present, so "exactly N keys" is "no extra key", and the two strategies differ
 * only in how they count:
 *
 * - `'count-keys'` — `Object.keys(obj).length === N`. Builds a keys array per
 *   call. The array is scalar-replaced on V8 when only its length is read, and
 *   on JavaScriptCore it is the fast form by a wide margin: a `for…in` there
 *   takes a generic slow path over a non-extensible (frozen, sealed) object.
 * - `'count-enumerable'` — `let c = 0; for (const k in obj) c++`. Allocates
 *   nothing and is answered from V8's enum cache, so it is markedly faster on
 *   Node; on JavaScriptCore it is slower, and much slower on frozen input.
 *
 * The two also differ in *which* keys they see — `Object.keys` reads own keys,
 * `for…in` enumerable ones, inherited included — which only matters for a value
 * that could not have come from JSON. Each generator documents what its fast
 * path does with such a value under either strategy.
 *
 * mjst benches on Bun, so `'count-keys'` is the default: it is never worse
 * than about 0.9× there and up to 2× better on the strict parse case. A
 * consumer running on Node alone gains from flipping to `'count-enumerable'`.
 * The choice is made at generation time on purpose — generated code never
 * detects its runtime.
 */
export type UnknownKeysStrategy = 'count-enumerable' | 'count-keys'

/** Every strategy, in the order the CLI lists them. */
export const UNKNOWN_KEYS_STRATEGIES: readonly UnknownKeysStrategy[] = ['count-enumerable', 'count-keys']

/** The strategy used when a caller does not choose one — see {@link UnknownKeysStrategy}. */
export const DEFAULT_UNKNOWN_KEYS: UnknownKeysStrategy = 'count-keys'

/** True when `value` names a strategy — the check a CLI flag or a config key goes through. */
export const isUnknownKeysStrategy = (value: unknown): value is UnknownKeysStrategy =>
  typeof value === 'string' && (UNKNOWN_KEYS_STRATEGIES as readonly string[]).includes(value)
