import { effect } from 'alien-signals'

import { requireHost, scheduleFlush } from './current-host'
import type { HostElement, MiniChildren } from './types'

/**
 * Attaches children to an element.
 *
 * Strings and numbers become text nodes, host nodes are moved in, arrays
 * recurse, and `null`, `undefined`, and booleans vanish — which is what makes
 * `{condition && <text>…</text>}` work as a build-time conditional.
 *
 * A FUNCTION child is the reactive case: it gets its own text node bound to
 * whatever signals it reads. The dedicated node matters, because it means a
 * reactive child sitting next to static siblings only ever rewrites itself and
 * never clobbers them.
 */
export const appendChildren = (element: HostElement, children: MiniChildren): void => {
  if (children === null || children === undefined || typeof children === 'boolean') return

  if (Array.isArray(children)) {
    for (const child of children) appendChildren(element, child as MiniChildren)
    return
  }

  const host = requireHost()

  if (typeof children === 'function') {
    const get = children
    const text = host.createText('')
    effect(() => {
      const value = get()
      host.setText(text, value === null || value === undefined || value === false ? '' : String(value))
      scheduleFlush()
    })
    host.insert(element, text, null)
    scheduleFlush()
    return
  }

  if (isHostNode(children)) {
    host.insert(element, children, null)
    scheduleFlush()
    return
  }

  host.insert(element, host.createText(String(children)), null)
  scheduleFlush()
}

/**
 * Distinguishes an already-built host node from a primitive child.
 *
 * Host nodes are opaque to the runtime, so there is nothing structural to test
 * for. What we can say is that every remaining primitive child is a string or a
 * number by this point, so anything that is an object came out of the host and
 * belongs in the tree as-is.
 */
const isHostNode = (child: unknown): child is Exclude<MiniChildren, readonly unknown[]> & object =>
  typeof child === 'object' && child !== null
