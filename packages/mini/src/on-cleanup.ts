import { effect } from 'alien-signals'

/**
 * Registers `fn` to run once when the enclosing `effectScope` is disposed —
 * mini's teardown hook, colocated with the code that needs cleaning up
 * instead of threaded back through a hand-written dispose chain.
 *
 * It works by creating an effect whose body reads no signals (so it never
 * re-runs) and returns `fn` as its cleanup. alien-signals runs an effect's
 * returned cleanup when the effect is disposed, and disposing a scope
 * disposes every effect created inside it — so `fn` fires exactly once, at
 * scope teardown.
 *
 * Must be called synchronously inside an `effectScope` (which `mount` and
 * every `list` item open); outside one there is nothing to attach to and the
 * cleanup would never run.
 *
 * @example
 * ```tsx
 * const Clock = () => {
 *   const now = signal(Date.now())
 *   const id = setInterval(() => now(Date.now()), 1000)
 *   onCleanup(() => clearInterval(id)) // fires when the mount/list scope disposes
 *   return <time>{() => new Date(now()).toLocaleTimeString()}</time>
 * }
 * ```
 */
export const onCleanup = (fn: () => void): void => {
  effect(() => fn)
}
