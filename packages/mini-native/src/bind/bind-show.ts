import { effect } from 'alien-signals'

import { requireHost, scheduleFlush } from '../current-host'
import type { Dispose, HostElement } from '../types'

/**
 * Keeps an element's visibility in sync with a getter, hiding it in place
 * rather than detaching it.
 *
 * Hiding beats removing whenever the element comes back — there is no teardown
 * and no rebuild, so any state inside it survives. When the element should
 * genuinely leave the tree (and stop reacting), reach for `Show` instead.
 */
export const bindShow = (element: HostElement, get: () => boolean): Dispose => {
  const host = requireHost()
  return effect(() => {
    host.setVisible(element, get())
    scheduleFlush()
  })
}
