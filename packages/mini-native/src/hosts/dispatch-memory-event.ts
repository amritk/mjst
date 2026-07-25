import type { MemoryElement } from './create-memory-host'

/**
 * Fires an event on an element of the in-memory tree, invoking every listener
 * registered for that name.
 *
 * There is no bubbling here, which is not a simplification — it matches the
 * contract. Listeners are attached directly to their element on every target
 * precisely because native platforms have no bubbling phase, so a test that
 * relies on an event reaching an ancestor would be testing behaviour the real
 * hosts do not provide.
 */
export const dispatchMemoryEvent = (element: MemoryElement, name: string, event: unknown = {}): void => {
  const listeners = element.listeners.get(name)
  if (!listeners) return
  // Iterate a copy so a handler that detaches itself cannot disturb the walk.
  for (const listener of [...listeners]) listener(event)
}
