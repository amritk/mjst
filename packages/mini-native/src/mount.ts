import { effectScope } from 'alien-signals'

import { requireHost, scheduleFlush } from './current-host'
import type { Dispose, HostElement } from './types'

/**
 * Mounts a component into a container and returns a dispose that tears down
 * everything it set up — the application root.
 *
 * A component runs once and returns an element, and the reactivity it creates
 * along the way (bindings, effects, `onCleanup` registrations) belongs to
 * whatever `effectScope` was active while it ran. At the top level there is not
 * one, so a root component attached by hand would leave its effects with no
 * owner: nothing could dispose them and a top-level `onCleanup` would never
 * fire. `mount` is that owner. It runs the component inside a fresh scope,
 * attaches the node, and hands back a dispose that detaches the node and tears
 * the scope down.
 *
 * Call it once at the entry point, and call the returned dispose when the whole
 * tree should go away — a test finishing, a screen being popped, a hot reload.
 *
 * @example
 * ```tsx
 * setHost(createDomHost())
 * const dispose = mount(domRoot(document.body), App)
 * ```
 */
export const mount = (container: HostElement, component: () => HostElement): Dispose => {
  const host = requireHost()
  // effectScope runs its body synchronously, so the assignment is definite —
  // just invisible to the compiler, hence the non-null claim.
  let node!: HostElement
  const dispose = effectScope(() => {
    node = component()
  })
  host.insert(container, node, null)
  scheduleFlush()

  return () => {
    dispose()
    host.remove(node)
    scheduleFlush()
  }
}
