/**
 * Tracks the two generated forms of a `$ref` target. We compile a ref to a
 * named local function so recursive schemas terminate (and so a ref used many
 * times is emitted once). A ref can be reached from both a boolean context
 * (inside `anyOf`/`not`, or the whole guard validator) and an error-collecting
 * context, so we may need both forms — but only generate the ones actually hit.
 */
export type RefEntry = {
  /** Name of the boolean form: `(d) => boolean`. */
  guardName?: string
  /** Name of the error-collecting form: `(d, p, errs) => void`. */
  errorName?: string
}

/**
 * Mutable state threaded through code generation.
 *
 * The compiler emits plain JavaScript source as strings and assembles it into a
 * single function via `new Function`. Anything that cannot be expressed as a
 * literal — `RegExp`, enum lookup `Set`s, deep-equal comparison values — is
 * pushed onto {@link hoist} and referenced positionally as `h[i]`, so it is
 * created once at compile time instead of on every validation call.
 */
export type CompilerContext = {
  /** The root schema document, used to resolve local `$ref` pointers. */
  readonly root: unknown
  /** Values closed over by the compiled function, referenced as `h[i]`. */
  readonly hoist: unknown[]
  /** Dedupes hoisted values by a string key so identical regexes share a slot. */
  readonly hoistKeys: Map<string, number>
  /** Per-ref bookkeeping keyed by the raw `$ref` string. */
  readonly refs: Map<string, RefEntry>
  /** Generated `function ref_*` declarations, injected at the top of the body. */
  readonly refDecls: string[]
  /** Enabled string formats, or `'all'`. */
  readonly formats: 'all' | ReadonlySet<string>

  /** Whether the current position collects errors (vs. boolean short-circuit). */
  emitErrors: boolean
  /** Set when the `deepEqual` runtime helper must be emitted. */
  needsDeepEqual: boolean
  /** Set when the `unique` runtime helper must be emitted. */
  needsUnique: boolean

  /** Mints a unique local identifier, e.g. `v0`, `v1`. */
  nextVar: (prefix?: string) => string
  /** Hoists a value and returns the accessor expression (`h[3]`). */
  addHoist: (value: unknown, key: string) => string
  /**
   * Emits the failure statement for the current context. In error mode it
   * pushes a `{ message, path }`; in boolean mode it runs the supplied
   * short-circuit statement (e.g. `return false` or `ok = false`).
   */
  fail: (message: string, pathExpr: string) => string
}

/**
 * Builds a fresh {@link CompilerContext}. `emitErrors` seeds whether the root
 * validator collects errors ({@link validate}) or is a pure boolean guard
 * ({@link validateGuard}); the failure statement is wired up by the caller.
 */
export const createContext = (
  root: unknown,
  formats: 'all' | ReadonlySet<string>,
  emitErrors: boolean,
): CompilerContext => {
  let counter = 0

  const hoist: unknown[] = []
  const hoistKeys = new Map<string, number>()

  const ctx: CompilerContext = {
    root,
    hoist,
    hoistKeys,
    refs: new Map(),
    refDecls: [],
    formats,
    emitErrors,
    needsDeepEqual: false,
    needsUnique: false,
    nextVar: (prefix = 'v') => `${prefix}${counter++}`,
    addHoist: (value, key) => {
      const existing = hoistKeys.get(key)
      if (existing !== undefined) return `h[${existing}]`
      const index = hoist.length
      hoist.push(value)
      hoistKeys.set(key, index)
      return `h[${index}]`
    },
    // Placeholder; the entry points overwrite this with the right strategy.
    fail: () => '',
  }

  return ctx
}
