import { setActiveSub } from 'alien-signals'

/**
 * Runs `build` with no reactive owner installed, so whatever it creates belongs
 * to the code that captures it rather than to the effect that happened to be
 * running at the time.
 *
 * This exists for one specific alien-signals behaviour: a scope created inside a
 * running effect is torn down when that effect RE-RUNS, before the new run's
 * body starts. For ordinary nesting that is exactly what you want, but it is
 * fatal anywhere a long-lived subtree is built from inside a tracking effect.
 *
 * A keyed list is the clear case. Rows are built inside the reconciliation
 * effect, and that effect re-runs on every change to the collection. Without
 * detaching, appending a single row silently disposes every row already on
 * screen — the nodes stay in the document looking perfectly correct while all of
 * their bindings quietly stop updating, and each surviving row's `onCleanup`
 * fires as if it had been removed. Detaching hands row lifetime back to the code
 * that actually knows when a row should die: `list` disposes a row when its key
 * disappears, and disposes all of them when it is torn down.
 *
 * @example
 * ```ts
 * // Inside an effect that re-runs, but the scope must outlive this run:
 * const dispose = runDetached(() => effectScope(() => buildRow(item)))
 * ```
 */
export const runDetached = <T>(build: () => T): T => {
  const previous = setActiveSub(undefined)
  try {
    return build()
  } finally {
    setActiveSub(previous)
  }
}
