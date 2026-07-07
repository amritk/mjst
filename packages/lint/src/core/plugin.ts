import type { ParserFormat } from '../parsers'
import type { Document } from './document'
import type { Ruleset } from './ruleset'
import type { IDiagnostic } from './types'

/**
 * Everything a plugin needs about the document it is post-processing: the raw
 * input text and its format (so a plugin can produce text edits), the parsed
 * {@link Document} with its source map, the dereferenced tree, and the ruleset
 * that produced the findings.
 */
export type LintPluginContext = {
  source?: string | undefined
  /** The original, unparsed document text. */
  input: string
  /** Which concrete parser the document was routed to (drives text-edit serialization). */
  format: ParserFormat
  document: Document
  /** The dereferenced document data, as passed to the runner. */
  resolved: unknown
  ruleset: Ruleset
}

/**
 * What a plugin's `afterLint` hook may return. Every field is optional: a plugin
 * that only observes returns nothing. A plugin that rewrites the document (e.g.
 * auto-fix) returns `output`; one that resolves or adds findings returns
 * `diagnostics`; structured results go in `data` (keyed by plugin name).
 */
export type LintPluginResult = {
  /** A rewritten version of the document text (e.g. with fixes applied). */
  output?: string
  /** Diagnostics that replace the ones passed in (e.g. with fixed ones removed). */
  diagnostics?: IDiagnostic[]
  /** Arbitrary structured output, surfaced under the plugin's name. */
  data?: unknown
}

/**
 * A Linter plugin. The lint pipeline invokes registered plugins after the rule
 * run via {@link runPlugins}. The hook is intentionally small — a single
 * post-lint pass — so the core engine stays unaware of any specific plugin (the
 * auto-fix subsystem, for instance, is just a plugin that returns `output`).
 */
export type LintPlugin = {
  name: string
  afterLint?: (diagnostics: IDiagnostic[], context: LintPluginContext) => LintPluginResult | undefined
}

/** The combined result of running every plugin over a document's findings. */
export type PluginRunResult = {
  diagnostics: IDiagnostic[]
  /** The last `output` any plugin produced, if any rewrote the document. */
  output?: string
  /** Per-plugin structured `data`, keyed by plugin name. */
  data: Record<string, unknown>
}

/**
 * Runs `plugins` in order over `diagnostics`. Each plugin sees the (possibly
 * already transformed) diagnostics from the previous one; when a plugin returns
 * `output`, later plugins and the context see that rewritten text as `input`.
 */
export const runPlugins = (
  plugins: readonly LintPlugin[],
  diagnostics: IDiagnostic[],
  context: LintPluginContext,
): PluginRunResult => {
  let currentDiagnostics = diagnostics
  let currentInput = context.input
  let output: string | undefined
  const data: Record<string, unknown> = {}

  for (const plugin of plugins) {
    const result = plugin.afterLint?.(currentDiagnostics, { ...context, input: currentInput })
    if (!result) continue
    if (result.diagnostics) currentDiagnostics = result.diagnostics
    if (result.output !== undefined) {
      output = result.output
      currentInput = result.output
    }
    if (result.data !== undefined) data[plugin.name] = result.data
  }

  return { diagnostics: currentDiagnostics, data, ...(output !== undefined ? { output } : {}) }
}
