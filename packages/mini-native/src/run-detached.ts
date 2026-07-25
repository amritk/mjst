import { setActiveSub } from 'alien-signals'

/**
 * Runs `build` with no reactive owner installed, so anything it creates belongs
 * to whoever captures it rather than to the effect that happened to be running.
 *
 * This exists because of one specific alien-signals behaviour: a scope created
 * inside a running effect is torn down when that effect RE-RUNS. For most
 * nesting that is exactly right, but it is fatal for the two places that build
 * long-lived subtrees from inside a tracking effect.
 *
 * A keyed list is the clear case. Rows are built inside the reconciliation
 * effect, and that effect re-runs on every change to the collection. Without
 * detaching, appending a single row would silently dispose every row already on
 * screen — the nodes would stay in the tree, looking perfectly fine, while
 * every binding inside them stopped updating. Detaching hands row lifetime back
 * to the code that actually knows when a row should die: `list` disposes a row
 * when its key disappears, and disposes all of them when it is torn down.
 */
export const runDetached = <T>(build: () => T): T => {
  const previous = setActiveSub(undefined)
  try {
    return build()
  } finally {
    setActiveSub(previous)
  }
}
