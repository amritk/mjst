import type { ErrorPayload, Plugin, ViteDevServer } from 'vite'

import { type CalledSignalBinding, findCalledSignalBindings } from './find-called-signal-bindings'

/**
 * Options for {@link catchCalledSignals}. The default severity tracks the Vite
 * command so the same plugin serves both jobs the user wants: a non-blocking
 * nudge while developing and a hard gate in CI.
 */
export type CatchCalledSignalsOptions = {
  /**
   * Fail the build instead of only warning. Defaults to `true` during
   * `vite build` and `false` during `vite serve`, so the dev server keeps
   * running while you fix the binding, and the production build (CI) refuses
   * to ship a frozen signal. Set it explicitly to force one behaviour.
   */
  readonly failOnError?: boolean
  /**
   * Surface findings in Vite's error overlay during dev, on top of the terminal
   * warnings. The overlay is non-blocking — the module still loads — and clears
   * itself on the next clean edit. Defaults to `true`; set `false` to keep the
   * feedback in the terminal only.
   */
  readonly overlay?: boolean
}

/** A `.tsx` module we should scan — not a virtual module, not a dependency. */
const isScannable = (id: string): boolean => {
  const path = id.split('?', 1)[0] ?? id
  return path.endsWith('.tsx') && !path.includes('/node_modules/')
}

/** The human-facing message for one finding — the fix is in the text, not just the rule name. */
const describe = ({ attribute, callee }: CalledSignalBinding): string => {
  const [was, fix] =
    attribute === undefined
      ? [`{${callee}()}`, `{${callee}}`]
      : [`${attribute}={${callee}()}`, `${attribute}={${callee}}`]
  return `${was} calls the signal and freezes it at creation — pass ${fix} (no parentheses) to keep it reactive`
}

/**
 * A one-line source frame with a caret under the finding, for the overlay. The
 * `>` gutter marks the offending line the way Vite's own frames do.
 */
const frameFor = (code: string, binding: CalledSignalBinding): string => {
  const line = code.split('\n')[binding.line - 1] ?? ''
  const gutter = `> ${binding.line} | `
  const caret = `${' '.repeat(gutter.length + binding.column - 1)}^`
  return `${gutter}${line}\n${caret}`
}

/**
 * Builds the overlay payload for a file's findings. The overlay shows one error
 * at a time, so every binding goes into the message and the first anchors the
 * `loc`/frame — the terminal warnings remain the full, clickable list.
 */
const overlayError = (code: string, id: string, bindings: readonly CalledSignalBinding[]): ErrorPayload['err'] => {
  const first = bindings[0] as CalledSignalBinding
  const lines = bindings.map((binding) => `  ${id}:${binding.line}:${binding.column}  ${describe(binding)}`)
  return {
    plugin: '@amritk/mini:catch-called-signals',
    message: `${bindings.length} frozen signal binding${bindings.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
    stack: '',
    id,
    frame: frameFor(code, first),
    loc: { file: id, line: first.line, column: first.column },
  }
}

/**
 * A Vite plugin that catches mini's called-signal footgun as you type. It scans
 * each `.tsx` module in `transform` (so it re-runs on every edit) using the same
 * {@link findCalledSignalBindings} core as the CLI, warns with a clickable
 * `file:line:column`, shows the findings in the dev overlay, and — during
 * `vite build` — fails the build so the mistake cannot reach production. It
 * never rewrites your code; `transform` always returns `null`.
 */
export const catchCalledSignals = (options: CatchCalledSignalsOptions = {}): Plugin => {
  // Captured from `configResolved` so the default severity can follow the
  // command (`serve` warns, `build` fails) unless `failOnError` overrides it.
  let failByDefault = false
  // The dev server, captured in `serve` only, so `transform` can push the
  // overlay over its WebSocket. `undefined` during `build`.
  let server: ViteDevServer | undefined

  return {
    name: '@amritk/mini:catch-called-signals',
    // Run before the JSX transform rewrites the tree — we want the source the
    // developer actually wrote, and we only read it.
    enforce: 'pre',
    configResolved(config) {
      failByDefault = config.command === 'build'
    },
    configureServer(devServer) {
      server = devServer
    },
    transform(code, id) {
      if (id.startsWith('\0') || !isScannable(id)) return null

      const bindings = findCalledSignalBindings(code)
      if (bindings.length === 0) return null

      for (const binding of bindings) {
        this.warn({ message: describe(binding), id, loc: { file: id, line: binding.line, column: binding.column } })
      }

      // Warn on every finding first (so the whole file's problems show at once),
      // then abort if we are gating — `this.error` throws and stops the build.
      if (options.failOnError ?? failByDefault) {
        const count = bindings.length
        this.error(
          `${count} frozen signal binding${count === 1 ? '' : 's'} in this file — pass the getter without () to keep bindings reactive`,
        )
      }

      // Non-blocking dev overlay: the module still loads, and the next clean
      // edit sends an HMR update that dismisses it.
      if (server !== undefined && options.overlay !== false) {
        server.ws.send({ type: 'error', err: overlayError(code, id, bindings) })
      }

      return null
    },
  }
}
