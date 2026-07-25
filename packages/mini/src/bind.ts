import { effect } from 'alien-signals'

import type { Signal } from './signals'

/**
 * Reactive DOM bindings — each ties one node property to a signal-reading
 * getter and re-runs only when the signals it read change. All of them return
 * the effect's stop function, though most callers rely on `effectScope`
 * disposal instead of stopping bindings one by one.
 *
 * These write through `textContent`, attributes, and classList — never
 * `innerHTML` — so bound data cannot inject markup. The single sanctioned
 * HTML sink is `bindHtml` below.
 */

/**
 * Attaches DOM listeners inside a no-dependency effect and returns its stop.
 * Because the listeners live in an effect, disposing the surrounding
 * `effectScope` detaches them too — so a two-way bind whose combined dispose is
 * never called by hand (the documented `effectScope`-disposal path) still tears
 * down its element→signal listeners, not just its signal→element effect. Calling
 * the returned stop by hand detaches them the same way, and doing both is safe:
 * the effect's cleanup runs at most once.
 */
const listen = (node: EventTarget, handlers: readonly [type: string, handler: EventListener][]): (() => void) =>
  effect(() => {
    for (const [type, handler] of handlers) node.addEventListener(type, handler)
    return () => {
      for (const [type, handler] of handlers) node.removeEventListener(type, handler)
    }
  })

/** Keeps `node.textContent` equal to the getter's value. */
export const bindText = (node: Node, get: () => string): (() => void) =>
  effect(() => {
    node.textContent = get()
  })

/**
 * Keeps an attribute in sync. `false`/`null` removes the attribute and `true`
 * sets it bare, so the same helper covers boolean attributes like `disabled`.
 */
export const bindAttr = (node: Element, name: string, get: () => string | boolean | null): (() => void) =>
  effect(() => {
    const value = get()
    if (value === false || value === null) node.removeAttribute(name)
    else node.setAttribute(name, value === true ? '' : value)
  })

/** Toggles a single class with the getter's boolean. */
export const bindClass = (node: Element, name: string, get: () => boolean): (() => void) =>
  effect(() => {
    node.classList.toggle(name, get())
  })

/**
 * What an element's single inline `display` slot is being asked for, by the two
 * features that both want to write it.
 */
type DisplayState = {
  /** Whether `bindShow` currently has this element hidden. */
  hidden: boolean
  /** The `display` the element's own style asked for — `''` means its natural one. */
  styleDisplay: string
}

/**
 * Only elements something has actually hidden get an entry, so an element with
 * a plain `style` prop and no `show` pays one lookup miss and nothing else.
 */
const displays = new WeakMap<HTMLElement | SVGElement, DisplayState>()

/**
 * Resolves the one inline `display` that `show` and a `style` write are
 * competing for, so neither silently undoes the other.
 *
 * `bindShow` hides by writing `display: none`, while applying a style bag
 * replaces the inline style wholesale — so on an element carrying both props the
 * style write un-hides it, and which one wins comes down to the order the
 * attributes happened to be typed in. Remembering the two intents apart is what
 * makes that order stop mattering. Hiding wins while it is in effect; otherwise
 * the element gets back exactly the `display` its style asked for, which is why
 * showing it again does not just restore a hardcoded `''`.
 *
 * The bookkeeping lives here rather than in the JSX runtime because `bindShow`
 * is public API that people call straight from a `ref` — the JSX path is only
 * one of its callers. `mini-native` solves the same collision inside its DOM
 * host; the two packages share no code by design.
 *
 * @param node The element whose `display` is being resolved.
 * @param hidden Visibility, when `bindShow` is the caller. Omit it after a style
 *   write to re-read whatever `display` that style just asked for.
 */
export const applyDisplay = (node: HTMLElement | SVGElement, hidden?: boolean): void => {
  const known = displays.get(node)
  // Nothing has hidden this element, so its own style owns `display` outright
  // and there is nothing to arbitrate.
  if (known === undefined && hidden === undefined) return
  // A first registration reads the current inline `display` as the style's,
  // which is what makes `<div style={…} show={…}>` work in either prop order.
  const state = known ?? { hidden: false, styleDisplay: node.style.display }
  if (hidden === undefined) state.styleDisplay = node.style.display
  else state.hidden = hidden
  if (known === undefined) displays.set(node, state)
  node.style.display = state.hidden ? 'none' : state.styleDisplay
}

/**
 * Shows or hides the node via inline `display`, remembering the intent so a
 * later `style` write cannot quietly un-hide it — see {@link applyDisplay}.
 */
export const bindShow = (node: HTMLElement, get: () => boolean): (() => void) =>
  effect(() => {
    applyDisplay(node, !get())
  })

/**
 * The one sanctioned `innerHTML` sink. The sanitizer is a required explicit
 * argument at every call site — never a default — so `grep bindHtml` audits
 * the widget's entire XSS surface in one search.
 */
export const bindHtml = (node: Element, sanitize: (raw: string) => string, get: () => string): (() => void) =>
  effect(() => {
    node.innerHTML = sanitize(get())
  })

/**
 * Two-way binding between a text input (or textarea) and a string signal —
 * mini's `v-model`. The element's `value` follows the signal, and typing
 * writes the signal back on every `input` event.
 *
 * Writing `value` back is guarded on inequality so echoing the freshly-typed
 * character never repositions the caret. IME composition (CJK, accents) is held
 * off: while a composition is in flight the signal is not written and the
 * element is not overwritten, and the final text is committed once on
 * `compositionend` — otherwise the mid-composition `input` events would tear the
 * candidate string apart. A write to the signal that lands mid-composition is
 * not dropped: it is deferred and applied at `compositionend`, where it wins
 * over the candidate text, on the grounds that an app clearing a field is being
 * deliberate. Returns a combined dispose that stops the effect and detaches
 * every listener.
 *
 * @example
 * ```tsx
 * const name = signal('')
 * const input = (<input placeholder="name" />) as HTMLInputElement
 * bindValue(input, name) // two-way: typing writes name(), name('x') sets the field
 * ```
 */
export const bindValue = (node: HTMLInputElement | HTMLTextAreaElement, model: Signal<string>): (() => void) => {
  let composing = false
  // A write to the signal that arrived mid-composition and still has to land.
  let deferred = false
  /** Pushes the signal onto the element, skipping a write that would not change it. */
  const push = (): void => {
    const next = model()
    if (node.value !== next) node.value = next
  }
  const stop = effect(() => {
    // Read unconditionally, so the effect keeps tracking the signal even on the
    // runs it declines to apply.
    const next = model()
    // Writing now would tear the IME's candidate string apart, so the write is
    // remembered and settled once the composition ends.
    if (composing) deferred = true
    else if (node.value !== next) node.value = next
  })
  const stopListeners = listen(node, [
    [
      'input',
      () => {
        if (!composing) model(node.value)
      },
    ],
    [
      'compositionstart',
      () => {
        composing = true
      },
    ],
    [
      'compositionend',
      () => {
        composing = false
        if (deferred) {
          // The app wrote to the signal while the user was mid-composition —
          // clearing the field on submit, say. That is a deliberate override, so
          // it wins over the candidate text instead of being read back and
          // silently discarded. Reading back here would set the signal FROM the
          // element, the two would agree again, and the tracking effect would
          // have nothing left to re-apply: the write would simply vanish.
          deferred = false
          push()
          return
        }
        model(node.value)
      },
    ],
  ])
  return () => {
    stop()
    stopListeners()
  }
}

/**
 * Two-way binding between a `<select>` and a string signal — the `bindValue`
 * analogue for a dropdown. The element's `value` follows the signal (setting
 * `.value`, the property, so the matching `<option>` is selected — a bare
 * `value` attribute would not), and choosing an option writes the signal back
 * on `change`.
 *
 * `<select>` has no IME composition to hold off (there is no free text to
 * compose), so this stays simpler than the input/textarea path: one effect,
 * one `change` listener. Writing `value` back is still guarded on inequality so
 * an echo never reorders the option list. Returns a combined dispose that stops
 * the effect and detaches the listener.
 */
export const bindSelect = (node: HTMLSelectElement, model: Signal<string>): (() => void) => {
  const stop = effect(() => {
    const next = model()
    if (node.value !== next) node.value = next
  })
  const stopListeners = listen(node, [['change', () => model(node.value)]])
  return () => {
    stop()
    stopListeners()
  }
}

/**
 * Two-way binding between a checkbox (or radio) input and a boolean signal —
 * the `bindValue` analogue for `.checked`. The box follows the signal, and
 * toggling it writes the signal back on `change`. Returns a combined dispose
 * that stops the effect and detaches the listener.
 */
export const bindChecked = (node: HTMLInputElement, model: Signal<boolean>): (() => void) => {
  const stop = effect(() => {
    const next = model()
    if (node.checked !== next) node.checked = next
  })
  const stopListeners = listen(node, [['change', () => model(node.checked)]])
  return () => {
    stop()
    stopListeners()
  }
}
