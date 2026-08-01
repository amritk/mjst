import type { Writable } from 'node:stream'

/**
 * Waits for a Node writable whose `write` returned false to emit `'drain'`,
 * resolving `true` when it is safe to write again and `false` when the wait
 * cannot succeed — the stream errored, closed, or was already destroyed.
 *
 * The `'close'` and `'error'` guards are what keep the Node adapter's stream
 * pump from hanging: a client that disconnects mid-stream closes the response
 * without ever draining it, and a bare wait on `'drain'` would then wait
 * forever.
 *
 * The listeners are wired by hand rather than through `events.once` so this
 * module carries no `node:*` value import. `node:stream` above is type-only
 * and erases at compile time, which matters because this file sits in the
 * package root's import graph — and that graph is what a Workers or browser
 * bundler has to resolve. A bundler cannot tree-shake an unresolvable
 * `node:events` away; it fails the build first.
 */
export const waitForDrain = async (writable: Writable): Promise<boolean> => {
  if (writable.destroyed || writable.closed) return false
  return new Promise<boolean>((resolve) => {
    const settle = (drained: boolean): void => {
      writable.off('drain', onDrain)
      writable.off('close', onStop)
      writable.off('error', onStop)
      resolve(drained)
    }
    // A close or an error means the caller should stop pumping, not retry.
    const onDrain = (): void => settle(true)
    const onStop = (): void => settle(false)
    writable.once('drain', onDrain)
    writable.once('close', onStop)
    writable.once('error', onStop)
  })
}
