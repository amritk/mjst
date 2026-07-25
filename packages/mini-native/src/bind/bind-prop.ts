import { effect } from 'alien-signals'

import { requireHost, scheduleFlush } from '../current-host'
import type { Dispose, HostElement } from '../types'

/**
 * Keeps one property in sync with a getter. `false`, `null`, and `undefined`
 * unset the property, so the same helper covers boolean props like `disabled`.
 */
export const bindProp = (element: HostElement, name: string, get: () => unknown): Dispose => {
  const host = requireHost()
  return effect(() => {
    host.setProperty(element, name, get())
    scheduleFlush()
  })
}
