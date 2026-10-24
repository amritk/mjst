import type { IFunctionContext } from './types'

/**
 * Where one {@link Linter.run} call keeps what its built-in functions memoize.
 *
 * A function may cache its result by a node's identity — a `$ref` target is one
 * shared object in the resolved tree, so the same node reaches it many times in a
 * run. That cache has to end with the run: callers lint data they keep and edit in
 * place (`lint({ data })`, or `linter.run(document)` on a document whose data
 * changed), and a module-level cache would answer the edited node with what the
 * old one said. The runner hands every function context a fresh scope per run;
 * nothing outlives it.
 */
export type RunScope = Map<object, WeakMap<object, unknown>>

/** The context key the runner stores the run's scope under, out of reach of custom functions. */
export const RUN_SCOPE: unique symbol = Symbol('runScope')

/** A function context that carries its run's scope, as every context the runner builds does. */
type ScopedContext = IFunctionContext & { [RUN_SCOPE]?: RunScope }

/** A new, empty scope for one run. */
export const createRunScope = (): RunScope => new Map()

/**
 * The cache `owner` keeps for the current run: the same map for every call in one
 * run, a new one in the next. `owner` is any object private to the caller (its
 * module's own key), so two functions never read each other's entries. A context
 * the runner did not build — a function called directly — has no run to belong
 * to, and gets a map nothing else will see, which is the same as not caching.
 */
export const runCache = <V>(context: IFunctionContext, owner: object): WeakMap<object, V> => {
  const scope = (context as ScopedContext)[RUN_SCOPE]
  if (scope === undefined) return new WeakMap()
  const cache = scope.get(owner) ?? new WeakMap()
  scope.set(owner, cache)
  return cache as WeakMap<object, V>
}
