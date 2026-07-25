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
 *
 * The listeners are attached from INSIDE an effect, which is what ties them to
 * the enclosing `effectScope` rather than to the returned dispose alone. That
 * matters because the documented way to reach this is from a `ref`, where the
 * combined dispose is never called by hand and teardown is left to the scope:
 * without the effect the signal→element binding would be torn down and the
 * three element→signal listeners would not, leaving a half-disposed binding
 * behind — on a native target, a dispatcher the engine keeps calling for an
 * element nobody can see. Calling the returned dispose by hand detaches them
 * the same way, and doing both is safe: an effect's cleanup runs at most once.
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

  // No signal is read in here, so this effect never re-runs; it exists purely
  // so that disposing the scope detaches the listeners.
  const detach = effect(() => {
    const disposes = [
      host.addEventListener(element, 'input', readBack),
      host.addEventListener(element, 'compositionstart', () => {
        composing = true
      }),
      host.addEventListener(element, 'compositionend', () => {
        composing = false
        readBack()
      }),
    ]
    return () => {
      for (const dispose of disposes) dispose()
    }
  })

  return () => {
    stop()
    detach()
  }
}
