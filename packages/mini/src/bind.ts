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

/** Shows or hides the node via inline `display`. */
export const bindShow = (node: HTMLElement, get: () => boolean): (() => void) =>
  effect(() => {
    node.style.display = get() ? '' : 'none'
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
 * character never repositions the caret. Returns a combined dispose that
 * stops the effect and detaches the listener.
 */
export const bindValue = (node: HTMLInputElement | HTMLTextAreaElement, model: Signal<string>): (() => void) => {
  const stop = effect(() => {
    const next = model()
    if (node.value !== next) node.value = next
  })
  const onInput = (): void => model(node.value)
  node.addEventListener('input', onInput)
  return () => {
    stop()
    node.removeEventListener('input', onInput)
  }
}
