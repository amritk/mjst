import { detectFormat, type ParserFormat } from '../parsers'
import { createDocument, createDocumentFromData, type Document, type IDocumentOptions } from './document'
import { bySourceThenPosition, withoutDuplicates } from './order'
import type { LintPlugin } from './plugin'
import { runPlugins } from './plugin'
import type { Ruleset } from './ruleset'
import { createLinter } from './runner'
import { severityFromName } from './severity'
import type { DiagnosticSeverity, IDiagnostic, ISourceSet } from './types'

/**
 * What a {@link LintResolver} returns: the dereferenced tree, an optional source
 * set mapping inlined nodes back to their origin, and any diagnostics raised
 * while resolving (e.g. a `$ref` that could not be dereferenced). Surfacing
 * resolution failures as diagnostics keeps a typo'd ref or a failed fetch
 * visible instead of silently dropping it.
 */
export type LintResolverResult = {
  resolved: unknown
  sources?: ISourceSet
  diagnostics?: IDiagnostic[]
}

/**
 * How a resolved (`$ref`-dereferenced) tree is produced from a parsed document.
 * The engine stays free of any `$ref` resolver: a caller may inject one (for
 * example wrapping `@amritk/resolve-refs`). Returning no `sources` means
 * findings map back to the root document only; `diagnostics` reports refs that
 * failed to resolve.
 *
 * The `resolved` tree must be **acyclic**. Rules are evaluated by walking it, and
 * the walk is depth-unbounded by design (document depth is attacker-controlled,
 * so it keeps its own stack rather than recursing) — which means a cycle is an
 * infinite loop, not a `RangeError`. Shared subtrees are fine and expected;
 * `@amritk/resolve-refs` keeps the `$ref` node in place when a chain would close
 * a cycle, which is what makes its output safe here.
 *
 * Sharing should come from `$ref`s: an object that stands in the resolved tree
 * wherever a reference pointed at its target. The rule walk enters such an object
 * once rather than once per route, since every route leads back to the same
 * authored node; a resolver that shared objects for any other reason, without a
 * source set, would have findings at the later routes dropped.
 */
export type LintResolver = (
  document: Document,
  /** `input` is the document text: `''` when the caller linted data without it. */
  context: { input: string },
) => LintResolverResult | Promise<LintResolverResult>

/**
 * What {@link lint} reads: the document text, or data the caller has already
 * parsed — optionally with the text it came from, which is only read to put
 * line:column ranges on findings. See {@link createDocumentFromData}.
 */
export type LintInput = string | { data: unknown; text?: string }

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
  return severityFromName(value)
}

/**
 * Lints `input` against a normalized `ruleset`, returning the full
 * {@link LintResult} (findings plus anything the configured `plugins` produced).
 * This is the format-agnostic pipeline — parse with source maps → resolve (via
 * the injected {@link LintResolver}) → run the ruleset → run plugins. A higher
 * level entry point (such as `@amritk/lint`) supplies the ruleset, and
 * optionally a resolver and format-skip predicate; {@link lint} is a thin
 * wrapper returning just the diagnostics.
 *
 * Handed `{ data, text? }` instead of a string, the parse is skipped: the
 * run starts from the caller's data, and `text` (when given) is consulted
 * only to put ranges on findings. The resolver then sees `text` (or `''`)
 * as its `input`.
 */
export const lintWithResult = async (input: LintInput, options: LintOptions): Promise<LintResult> => {
  const { ruleset, resolve, skip, plugins, ...documentOptions } = options

  let document: Document
  let text: string
  if (typeof input === 'string') {
    const duplicateKeys = toParserSeverity(ruleset.parserOptions?.duplicateKeys)
    const incompatibleValues = toParserSeverity(ruleset.parserOptions?.incompatibleValues)
    document = createDocument(input, {
      ...documentOptions,
      ...(duplicateKeys !== undefined ? { duplicateKeys } : {}),
      ...(incompatibleValues !== undefined ? { incompatibleValues } : {}),
    })
    text = input
  } else {
    // A plugin such as auto-fix rewrites the text, so it cannot work from data alone.
    if (plugins && plugins.length > 0 && input.text === undefined) {
      throw new Error('Plugins need the document text: pass `text` alongside `data`')
    }
    document = createDocumentFromData(input.data, {
      ...(documentOptions.source !== undefined ? { source: documentOptions.source } : {}),
      ...(documentOptions.format !== undefined ? { format: documentOptions.format } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
    })
    text = input.text ?? ''
  }

  // Skip unrecognized-format documents before paying for resolution or the run.
  if (skip?.(document.data)) return { diagnostics: [], pluginData: {} }

  let resolved: unknown = document.data
  let sources: ISourceSet | undefined
  let resolverDiagnostics: IDiagnostic[] = []
  if (resolve) {
    const result = await resolve(document, { input: text })
    resolved = result.resolved
    sources = result.sources
    if (result.diagnostics) resolverDiagnostics = result.diagnostics
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

  const diagnostics = withoutDuplicates(
    [...parserResults, ...resolverDiagnostics, ...ruleResults].sort(bySourceThenPosition),
  )

  if (!plugins || plugins.length === 0) return { diagnostics, pluginData: {} }

  const format: ParserFormat = documentOptions.format ?? detectFormat(text)
  const run = runPlugins(plugins, diagnostics, {
    input: text,
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
export const lint = async (input: LintInput, options: LintOptions): Promise<IDiagnostic[]> =>
  (await lintWithResult(input, options)).diagnostics
