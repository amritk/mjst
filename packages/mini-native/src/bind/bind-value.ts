import { effect } from 'alien-signals'

import { requireHost, scheduleFlush } from '../current-host'
import type { Signal } from '../signals'
import type { Dispose, HostElement } from '../types'

/**
 * Two-way binding between a text `input` and a string signal.
 *
 * The element's value follows the signal, and typing writes the signal back on
 * every input event. Writing the value back is guarded on inequality so
 * echoing the character the user just typed never repositions their caret.
 *
 * Composition events (the intermediate states an IME emits while composing CJK
 * or accented text) are held off: while a composition is in flight the signal
 * is not written and the element is not overwritten, and the final text is
 * committed once at the end. Without this, the mid-composition input events
 * would tear the candidate string apart. Native targets generally do not emit
 * these events at all, in which case the guard simply never engages — the
 * host is free to ignore event names it has no equivalent for.
 */
export const bindValue = (element: HostElement, model: Signal<string>): Dispose => {
  const host = requireHost()
  let composing = false

  const stop = effect(() => {
    const next = model()
    if (!composing && host.getProperty(element, 'value') !== next) {
      host.setProperty(element, 'value', next)
      scheduleFlush()
    }
  })

  const readBack = (): void => {
    if (!composing) model(String(host.getProperty(element, 'value') ?? ''))
  }

  const detachInput = host.addEventListener(element, 'input', readBack)
  const detachStart = host.addEventListener(element, 'compositionstart', () => {
    composing = true
  })
  const detachEnd = host.addEventListener(element, 'compositionend', () => {
    composing = false
    readBack()
  })

  return () => {
    stop()
    detachInput()
    detachStart()
    detachEnd()
  }
}
