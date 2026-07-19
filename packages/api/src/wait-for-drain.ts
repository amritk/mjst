import { once } from 'node:events'
import type { Writable } from 'node:stream'

/**
 * Waits for a Node writable whose `write` returned false to emit `'drain'`,
 * resolving `true` when it is safe to write again and `false` when the wait
 * cannot succeed — the stream errored, closed, or was already destroyed.
 *
 * The `'close'` guard is what keeps the Node adapter's stream pump from
 * hanging: a client that disconnects mid-stream closes the response without
 * ever draining it, and a bare `once(response, 'drain')` would then wait
 * forever. `'error'` during the wait rejects `once` on its own; `'close'`
 * needs the explicit abort because it is not an error event.
 */
export const waitForDrain = async (writable: Writable): Promise<boolean> => {
  if (writable.destroyed || writable.closed) return false
  const controller = new AbortController()
  const bail = (): void => controller.abort()
  writable.once('close', bail)
  try {
    await once(writable, 'drain', { signal: controller.signal })
    return true
  } catch {
    // Either the abort (close during the wait) or an 'error' emission — in
    // both cases the caller should stop pumping, not retry.
    return false
  } finally {
    writable.off('close', bail)
  }
}
