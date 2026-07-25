import { effect } from 'alien-signals'

/**
 * Registers `fn` to run once when the enclosing `effectScope` is disposed —
 * the teardown hook, colocated with the code that needs cleaning up instead of
 * threaded back out through a hand-written dispose chain.
 *
 * It works by creating an effect whose body reads no signals (so it never
 * re-runs) and returns `fn` as its cleanup. alien-signals runs an effect's
 * returned cleanup when that effect is disposed, and disposing a scope disposes
 * every effect created inside it, so `fn` fires exactly once at teardown.
 *
 * Call it synchronously inside an `effectScope` — which `mount` opens, and
 * which every list row and control-flow branch opens for its own subtree.
 * Outside one there is nothing to attach to and the cleanup would never run.
 */
export const onCleanup = (fn: () => void): void => {
  effect(() => fn)
}
