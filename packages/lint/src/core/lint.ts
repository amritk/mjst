import { detectFormat, type ParserFormat } from '../parsers'
import { createDocument, type Document, type IDocumentOptions } from './document'
import type { LintPlugin } from './plugin'
import { runPlugins } from './plugin'
import type { Ruleset } from './ruleset'
import { createLinter } from './runner'
import { DiagnosticSeverity, type IDiagnostic, type ISourceSet } from './types'

/**
 * How a resolved (`$ref`-dereferenced) tree is produced from a parsed document.
 * The engine stays free of any `$ref` resolver: a caller may inject one (for
 * example wrapping `@amritk/resolve-refs`). Returning no `sources` means
 * findings map back to the root document only.
 */
export type LintResolver = (
  document: Document,
  context: { input: string },
) => { resolved: unknown; sources?: ISourceSet } | Promise<{ resolved: unknown; sources?: ISourceSet }>

/** Options for {@link lint} / {@link lintWithResult}. */
export type LintOptions = IDocumentOptions & {
  /** A normalized ruleset to evaluate (built via {@link createRuleset}). */
  ruleset: Ruleset
  /**
   * Produces the resolved tree for rules with `resolved: true`. When omitted the
   * raw parsed data is used as-is (no `$ref` dereferencing).
   */
  resolve?: LintResolver
  /**
   * Checked against the parsed data before any resolution: when it returns true
   * the document is skipped and produces no findings. Presets use this to skip
   * documents of an unrecognized format without paying for `$ref` resolution.
   */
  skip?: (data: unknown) => boolean
  /** Plugins run after the rule pass via {@link runPlugins} (e.g. auto-fix). */
  plugins?: LintPlugin[]
}

/** The full result of a {@link lintWithResult} run: findings plus plugin output. */
export type LintResult = {
  diagnostics: IDiagnostic[]
  /** A rewritten document, when a plugin (e.g. auto-fix) produced one. */
  output?: string
  /** Per-plugin structured output, keyed by plugin name. */
  pluginData: Record<string, unknown>
}

type ParserSeverity = DiagnosticSeverity | 'off'

const toParserSeverity = (value: DiagnosticSeverity | string | undefined): ParserSeverity | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'number') return value
  if (value === 'off') return 'off'
  const names: Record<string, DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warn: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  }
  return names[value]
}

const byPosition = (a: IDiagnostic, b: IDiagnostic): number => {
  const sa = a.source ?? ''
  const sb = b.source ?? ''
  if (sa !== sb) return sa < sb ? -1 : 1
  return a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character
}

/**
 * Lints `input` against a normalized `ruleset`, returning the full
 * {@link LintResult} (findings plus anything the configured `plugins` produced).
 * This is the format-agnostic pipeline — parse with source maps → resolve (via
 * the injected {@link LintResolver}) → run the ruleset → run plugins. A higher
 * level entry point (such as `@amritk/lint`) supplies the ruleset, and
 * optionally a resolver and format-skip predicate; {@link lint} is a thin
 * wrapper returning just the diagnostics.
 */
export const lintWithResult = async (input: string, options: LintOptions): Promise<LintResult> => {
  const { ruleset, resolve, skip, plugins, ...documentOptions } = options

  const duplicateKeys = toParserSeverity(ruleset.parserOptions?.duplicateKeys)
  const incompatibleValues = toParserSeverity(ruleset.parserOptions?.incompatibleValues)
  const document = createDocument(input, {
    ...documentOptions,
    ...(duplicateKeys !== undefined ? { duplicateKeys } : {}),
    ...(incompatibleValues !== undefined ? { incompatibleValues } : {}),
  })

  // Skip unrecognized-format documents before paying for resolution or the run.
  if (skip?.(document.data)) return { diagnostics: [], pluginData: {} }

  let resolved: unknown = document.data
  let sources: ISourceSet | undefined
  if (resolve) {
    const result = await resolve(document, { input })
    resolved = result.resolved
    sources = result.sources
  }

  const ruleResults = await createLinter(ruleset).run(document, { resolved, ...(sources ? { sources } : {}) })

  const parserResults = document.diagnostics.map((diagnostic): IDiagnostic => {
    const result: IDiagnostic = {
      code: 'parser',
      message: diagnostic.message,
      path: diagnostic.path ?? [],
      severity: diagnostic.severity,
      range: diagnostic.range,
    }
    if (document.source !== undefined) result.source = document.source
    return result
  })

  const diagnostics = [...parserResults, ...ruleResults].sort(byPosition)

  if (!plugins || plugins.length === 0) return { diagnostics, pluginData: {} }

  const format: ParserFormat = documentOptions.format ?? detectFormat(input)
  const run = runPlugins(plugins, diagnostics, {
    input,
    format,
    document,
    resolved,
    ruleset,
    ...(documentOptions.source !== undefined ? { source: documentOptions.source } : {}),
  })
  return {
    diagnostics: run.diagnostics,
    pluginData: run.data,
    ...(run.output !== undefined ? { output: run.output } : {}),
  }
}

/** Lints `input` against a normalized `ruleset` and returns just the findings. */
export const lint = async (input: string, options: LintOptions): Promise<IDiagnostic[]> =>
  (await lintWithResult(input, options)).diagnostics
