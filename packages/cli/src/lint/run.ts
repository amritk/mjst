import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { type LintResolver, lintDocument, type Ruleset, validateRuleset } from '@amritk/lint'
import { DiagnosticSeverity, type IDiagnostic, type RulesetDefinition } from '@amritk/lint/types'
import fg from 'fast-glob'
import yargs from 'yargs'

import { createLintResolver } from './resolver'
import { discoverRuleset, loadRuleset } from './ruleset-loader'

const SEVERITY_BY_NAME: Record<string, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warn: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

const SEVERITY_LABEL = ['error', 'warning', 'info', 'hint'] as const

/**
 * The built-in preset names `--ruleset` resolves without a file on disk, each
 * mapping to a *built* ruleset. Built rather than a definition, deliberately: a
 * preset brings its own custom functions and format detectors, which a
 * definition cannot carry — handed over as data, every one of its rules would
 * be silently skipped (unknown functions, a `formats` gate matching nothing).
 * The names mirror what the presets' own `extends` resolution accepts,
 * including the legacy Spectral aliases.
 */
const buildAsyncApiPreset = async (): Promise<Ruleset> =>
  (await import('@amritk/lint/rules/asyncapi')).createAsyncApiRuleset()
const buildOpenApiPreset = async (): Promise<Ruleset> =>
  (await import('@amritk/lint/rules/openapi')).createOpenApiRuleset()

// A Map, not a record: the key comes straight from `--ruleset`, and a record
// lookup on `constructor` would find `Object.prototype`'s.
const PRESET_RULESETS = new Map<string, () => Promise<Ruleset>>([
  ['asyncapi', buildAsyncApiPreset],
  ['loupe:asyncapi', buildAsyncApiPreset],
  ['spectral:asyncapi', buildAsyncApiPreset],
  ['oas', buildOpenApiPreset],
  ['loupe:oas', buildOpenApiPreset],
  ['spectral:oas', buildOpenApiPreset],
])

type Args = {
  documents: string[]
  ruleset?: string
  encoding: BufferEncoding
  failSeverity: string
  displayOnlyFailures: boolean
  verbose: boolean
  quiet: boolean
  stdinFilepath?: string
  concurrency: number
  resolve: boolean
  resolveRemote: boolean
  allowedHosts?: string[]
  allowPrivateHosts: boolean
  allowedRoots?: string[]
  /** Set by yargs when `--help`/`-h` was passed; it has already printed the usage. */
  help?: boolean
}

/**
 * Renders findings as a compact, dependency-free report — one `file:line:col`
 * line per finding (1-based, editor-clickable), then a count summary. Structured
 * output (JSON, SARIF, …) is a consumer concern: use the `@amritk/lint` library's
 * `lintDocument`, which returns `IDiagnostic[]`.
 */
const formatReport = (findings: IDiagnostic[]): string => {
  if (findings.length === 0) return 'No problems found\n'
  const lines = findings.map((d) => {
    const loc = `${d.source ?? '<stdin>'}:${d.range.start.line + 1}:${d.range.start.character + 1}`
    return `${loc}  ${SEVERITY_LABEL[d.severity] ?? 'error'}  ${d.code}  ${d.message}`
  })
  const errors = findings.filter((d) => d.severity === DiagnosticSeverity.Error).length
  const warnings = findings.filter((d) => d.severity === DiagnosticSeverity.Warning).length
  lines.push('', `✖ ${findings.length} problem(s) (${errors} error(s), ${warnings} warning(s))`)
  return `${lines.join('\n')}\n`
}

/** The outcome of a {@link run}: exit code plus the text it would print. */
export type RunResult = {
  code: number
  stdout: string
  stderr: string
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const filterBySeverity = (results: IDiagnostic[], failSeverity: DiagnosticSeverity): IDiagnostic[] =>
  results.filter((result) => result.severity <= failSeverity)

/**
 * Maps `items` through `worker` with at most `limit` running at once, preserving
 * input order in the result. Lets the CLI lint a directory of documents
 * concurrently instead of strictly one at a time, without unbounded parallelism.
 */
const mapWithConcurrency = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index] as T)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Parses the lint flags, returning either the parsed args or a usage message.
 *
 * The linter is `.strict()`: a mistyped `--fail-severity` or `--allowd-hosts`
 * used to be swallowed, so the run silently used the defaults and still reported
 * success — exactly the kind of quiet miss a lint gate exists to prevent.
 * `exitProcess(false)` plus an explicit `fail` handler keep yargs from tearing
 * the process down on that usage error: `run` is driven in-process by tests (and
 * by `mjst lint`, which owns the exit code), so the failure has to come back as a
 * value rather than a `process.exit`.
 */
const parseArgs = async (argv: string[]): Promise<{ args: Args } | { error: string }> => {
  try {
    const parsed = (await yargs(argv)
      .scriptName('lint')
      .parserConfiguration({ 'greedy-arrays': false })
      .strict()
      .exitProcess(false)
      .fail((message, error) => {
        throw error ?? new Error(message)
      })
      .usage('$0 [documents..]', 'Lint JSON/YAML documents against a ruleset')
      .positional('documents', { describe: 'Documents or globs to lint', type: 'string', array: true })
      .option('ruleset', {
        alias: 'r',
        type: 'string',
        describe: 'Path to a ruleset file, or a built-in preset: asyncapi, oas',
      })
      .option('encoding', { type: 'string', default: 'utf8', describe: 'Input encoding' })
      .option('fail-severity', { alias: 'F', type: 'string', default: 'error', choices: Object.keys(SEVERITY_BY_NAME) })
      .option('display-only-failures', { alias: 'D', type: 'boolean', default: false })
      .option('verbose', { type: 'boolean', default: false })
      .option('quiet', { alias: 'q', type: 'boolean', default: false })
      .option('stdin-filepath', {
        type: 'string',
        describe: 'Path to associate with stdin input (labels findings and enables ruleset discovery)',
      })
      .option('concurrency', {
        type: 'number',
        default: 8,
        describe: 'Maximum number of documents to lint in parallel',
      })
      .option('resolve', {
        type: 'boolean',
        default: true,
        describe: 'Dereference $ref / $dynamicRef / $recursiveRef before linting (use --no-resolve to disable)',
      })
      .option('resolve-remote', {
        type: 'boolean',
        default: false,
        describe: 'Allow fetching http(s) $refs while resolving (off by default; a lint run stays offline)',
      })
      .option('allowed-hosts', {
        type: 'string',
        array: true,
        describe: 'Restrict remote $ref fetches to these hosts (implies --resolve-remote)',
      })
      .option('allow-private-hosts', {
        type: 'boolean',
        default: false,
        describe: 'Permit remote $refs to private/loopback hosts (SSRF guard, off by default)',
      })
      .option('allowed-roots', {
        type: 'string',
        array: true,
        describe:
          "Extra directories a local $ref may resolve into, beyond the document's own (repeat the flag; relative to the current directory)",
      })
      .help()
      .alias('help', 'h')
      .parse()) as unknown as Args

    // `--concurrency abc` coerces to NaN, which used to reach `new Array(NaN)`
    // and blow up with a bare "Invalid array length" — say what is wrong instead.
    if (!Number.isFinite(parsed.concurrency) || parsed.concurrency < 1) {
      return { error: 'Invalid --concurrency value. Expected a positive number.' }
    }

    return { args: parsed }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Runs the linter over `argv`, returning the exit code and the text it would
 * print (rather than writing to the process streams) so it can be driven
 * in-process by tests. `stdin` supplies the piped document when there are no file
 * targets; when omitted it is read from `process.stdin`.
 */
export const run = async (argv: string[], options: { stdin?: string } = {}): Promise<RunResult> => {
  const out: string[] = []
  const err: string[] = []

  const outcome = await parseArgs(argv)
  if ('error' in outcome) {
    return { code: 2, stdout: '', stderr: `${outcome.error}\nRun \`mjst lint --help\` for the supported flags.\n` }
  }

  const parsed = outcome.args

  // yargs prints the help text itself (it writes straight to stdout), so there is
  // nothing left to lint — returning early keeps `mjst lint --help` from falling
  // through to the stdin branch and hanging on an empty pipe.
  if (parsed.help) return { code: 0, stdout: '', stderr: '' }

  const failSeverity = SEVERITY_BY_NAME[parsed.failSeverity] ?? DiagnosticSeverity.Error

  // A non-empty --allowed-hosts is an explicit opt-in to remote fetching.
  const allowRemote = parsed.resolveRemote || (parsed.allowedHosts?.length ?? 0) > 0
  const resolver: LintResolver | undefined = parsed.resolve
    ? createLintResolver({
        remote: allowRemote,
        ...(parsed.allowedHosts ? { allowedHosts: parsed.allowedHosts } : {}),
        allowPrivateHosts: parsed.allowPrivateHosts,
        ...(parsed.allowedRoots ? { allowedRoots: parsed.allowedRoots } : {}),
      })
    : undefined

  const reportRulesetProblems = (definition: RulesetDefinition, label: string): void => {
    if (parsed.quiet) return
    for (const problem of validateRuleset(definition)) {
      const at = problem.path.length > 0 ? ` (at ${problem.path.join('.')})` : ''
      err.push(`warning: ruleset ${label}: ${problem.message}${at}\n`)
    }
  }

  const discoverAndLoad = async (
    dir: string,
  ): Promise<{ definition: RulesetDefinition; basePath: string } | undefined> => {
    const discovered = discoverRuleset(dir)
    if (!discovered) return undefined
    const definition = await loadRuleset(discovered)
    reportRulesetProblems(definition, discovered)
    return { definition, basePath: dirname(discovered) }
  }

  let rulesetDefinition: RulesetDefinition | Ruleset | undefined
  let rulesetBasePath: string | undefined
  if (parsed.ruleset) {
    const preset = PRESET_RULESETS.get(parsed.ruleset)
    if (preset) {
      // Built presets carry their functions and formats already; there is no
      // definition to validate and no base path to resolve extends from.
      rulesetDefinition = await preset()
    } else {
      const definition = await loadRuleset(parsed.ruleset)
      rulesetDefinition = definition
      rulesetBasePath = dirname(isAbsolute(parsed.ruleset) ? parsed.ruleset : resolve(process.cwd(), parsed.ruleset))
      reportRulesetProblems(definition, parsed.ruleset)
    }
  }

  const documents = parsed.documents ?? []
  const targets = await fg(documents, { dot: true, onlyFiles: true })
  const allResults: IDiagnostic[] = []

  // Arguments that matched nothing must not fall through to stdin. In CI there is
  // no TTY, so stdin is an empty pipe: a typo'd path used to lint an empty
  // document, print "No problems found", and exit 0 — turning the lint gate into
  // a silent no-op that reports success. Only a run with no document arguments at
  // all is a stdin run.
  if (targets.length === 0 && documents.length > 0) {
    return { code: 2, stdout: '', stderr: `No files matched: ${documents.join(', ')}\n` }
  }

  if (targets.length === 0) {
    if (options.stdin === undefined && process.stdin.isTTY) {
      return { code: 2, stdout: '', stderr: 'No documents provided.\n' }
    }
    const content = options.stdin ?? (await readStdin())
    // With --stdin-filepath, label findings with that path and discover a
    // `.lint.*` ruleset by walking up from its directory.
    const stdinPath = parsed.stdinFilepath
    let definition = rulesetDefinition
    let basePath = rulesetBasePath
    if (!definition && !parsed.ruleset && stdinPath) {
      const discovered = await discoverAndLoad(dirname(stdinPath))
      if (discovered) ({ definition, basePath } = discovered)
    }
    const opts = {
      ...(definition ? { ruleset: definition } : {}),
      ...(basePath !== undefined ? { rulesetBasePath: basePath } : {}),
      ...(resolver && definition ? { resolve: resolver } : {}),
      source: stdinPath ?? '<stdin>',
    }
    allResults.push(...(await lintDocument(content, opts)))
  } else {
    // Cache discovered/loaded rulesets by directory so a directory of documents
    // that share a `.lint.*` file parses it once, not once per file.
    const rulesetCache = new Map<string, { definition: RulesetDefinition; basePath: string } | undefined>()
    const perFile = await mapWithConcurrency(targets, parsed.concurrency, async (file) => {
      const content = await readFile(file, parsed.encoding)
      let definition = rulesetDefinition
      let basePath = rulesetBasePath
      if (!definition && !parsed.ruleset) {
        const dir = dirname(file)
        let discovered = rulesetCache.get(dir)
        if (!rulesetCache.has(dir)) {
          discovered = await discoverAndLoad(dir)
          rulesetCache.set(dir, discovered)
        }
        if (discovered) ({ definition, basePath } = discovered)
      }
      const opts = definition
        ? {
            ruleset: definition,
            ...(basePath !== undefined ? { rulesetBasePath: basePath } : {}),
            ...(resolver ? { resolve: resolver } : {}),
            source: file,
          }
        : { source: file }
      return lintDocument(content, opts)
    })
    for (const remaining of perFile) allResults.push(...remaining)
  }

  const displayed = parsed.displayOnlyFailures ? filterBySeverity(allResults, failSeverity) : allResults
  if (!parsed.quiet) out.push(formatReport(displayed))

  return {
    code: filterBySeverity(allResults, failSeverity).length > 0 ? 1 : 0,
    stdout: out.join(''),
    stderr: err.join(''),
  }
}
