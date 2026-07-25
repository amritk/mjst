/**
 * The narrow slice of `console` this package uses. It is declared rather than
 * imported because the core compiles with no platform library at all — that
 * absence is what proves the runtime carries no DOM dependency — and `console`
 * is a host global rather than part of ECMAScript.
 */
type ConsoleLike = {
  warn: (...data: readonly unknown[]) => void
}

/**
 * Reports a mistake the runtime can recover from but the author almost
 * certainly wants to know about — a duplicate list key, say, where carrying on
 * silently would look like data quietly going missing.
 *
 * The logger is reached through `globalThis` and called optionally because a
 * JavaScript engine is not required to provide one. Every engine this package
 * targets does, but a runtime that renders to a native view tree has no
 * business assuming a browser's globals are there, and a missing console should
 * cost a warning rather than crash a screen.
 */
export const warn = (message: string, detail?: unknown): void => {
  const logger = (globalThis as { console?: ConsoleLike }).console
  if (detail === undefined) logger?.warn(`[mini-native] ${message}`)
  else logger?.warn(`[mini-native] ${message}`, detail)
}
