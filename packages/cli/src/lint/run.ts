import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  DiagnosticSeverity,
  type IDiagnostic,
  lintDocument,
  type RulesetDefinition,
  validateRuleset,
} from '@amritk/lint'
import { getFormatter } from '@amritk/lint/formatters'
import fg from 'fast-glob'
import yargs from 'yargs'

import { discoverRuleset, loadRuleset } from './ruleset-loader'

const SEVERITY_BY_NAME: Record<string, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warn: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

type Args = {
  documents: string[]
  ruleset?: string
  format: string[]
  output?: string[]
  encoding: BufferEncoding
  failSeverity: string
  displayOnlyFailures: boolean
  verbose: boolean
  quiet: boolean
  stdinFilepath?: string
  concurrency: number
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
 * Runs the linter over `argv`, returning the exit code and the text it would
 * print (rather than writing to the process streams) so it can be driven
 * in-process by tests. `stdin` supplies the piped document when there are no file
 * targets; when omitted it is read from `process.stdin`.
 */
export const run = async (argv: string[], options: { stdin?: string } = {}): Promise<RunResult> => {
  const out: string[] = []
  const err: string[] = []

  const parsed = (await yargs(argv)
    .scriptName('lint')
    .parserConfiguration({ 'greedy-arrays': false })
    .usage('$0 [documents..]', 'Lint JSON/YAML documents against a ruleset')
    .positional('documents', { describe: 'Documents or globs to lint', type: 'string', array: true })
    .option('ruleset', { alias: 'r', type: 'string', describe: 'Path to a ruleset file' })
    .option('format', { alias: 'f', type: 'string', array: true, default: ['stylish'], describe: 'Output format(s)' })
    .option('output', {
      alias: 'o',
      type: 'string',
      array: true,
      describe: 'Write output to a file instead of stdout (repeatable; paired with --format by position)',
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
    .help()
    .alias('help', 'h')
    .parse()) as unknown as Args

  const failSeverity = SEVERITY_BY_NAME[parsed.failSeverity] ?? DiagnosticSeverity.Error

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

  let rulesetDefinition: RulesetDefinition | undefined
  let rulesetBasePath: string | undefined
  if (parsed.ruleset) {
    rulesetDefinition = await loadRuleset(parsed.ruleset)
    rulesetBasePath = dirname(isAbsolute(parsed.ruleset) ? parsed.ruleset : resolve(process.cwd(), parsed.ruleset))
    reportRulesetProblems(rulesetDefinition, parsed.ruleset)
  }

  const targets = await fg(parsed.documents ?? [], { dot: true, onlyFiles: true })
  const allResults: IDiagnostic[] = []

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
            source: file,
          }
        : { source: file }
      return lintDocument(content, opts)
    })
    for (const remaining of perFile) allResults.push(...remaining)
  }

  const displayed = parsed.displayOnlyFailures ? filterBySeverity(allResults, failSeverity) : allResults

  // Each --format writes to the --output at the same position, else to stdout.
  for (let i = 0; i < parsed.format.length; i++) {
    const output = getFormatter(parsed.format[i] as string)(displayed)
    const file = parsed.output?.[i]
    if (file) await writeFile(file, output)
    else if (!parsed.quiet) out.push(`${output}\n`)
  }

  return {
    code: filterBySeverity(allResults, failSeverity).length > 0 ? 1 : 0,
    stdout: out.join(''),
    stderr: err.join(''),
  }
}
