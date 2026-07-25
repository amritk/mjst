import { effect } from 'alien-signals'

import { requireHost, scheduleFlush } from '../current-host'
import type { Dispose, HostText } from '../types'

/**
 * Keeps a text node's content equal to the getter's value.
 *
 * This writes through the host's text API and never through anything that
 * parses markup, so bound data cannot inject elements into the tree. That is
 * true on every target by construction — there is no raw-markup sink in the
 * host contract at all.
 */
export const bindText = (node: HostText, get: () => string): Dispose => {
  const host = requireHost()
  return effect(() => {
    host.setText(node, get())
    scheduleFlush()
  })
}
