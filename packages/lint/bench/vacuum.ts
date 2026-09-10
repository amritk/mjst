import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Benchmarks `mjst lint` head-to-head against **[vacuum](https://github.com/daveshanley/vacuum)**,
 * the Go OpenAPI linter, over the same real-world specs the Spectral bench uses.
 *
 * This one is deliberately shaped differently from `bench/run.ts`. vacuum is a
 * compiled Go binary, so there is no in-process comparison to make: the only
 * honest measurement is the one a user actually experiences — two command-line
 * tools, each started fresh, each linting the same file with its own
 * recommended OpenAPI preset. Every figure here therefore includes process
 * start, module loading, ruleset assembly, parsing, `$ref` resolution and the
 * rules themselves.
 *
 * That makes the fixed cost of starting up a real part of the result rather
 * than noise, so it is measured on its own: a near-empty OpenAPI document is
 * linted first, and its time is what each tool spends before doing any work
 * worth speaking of. Subtracting it from the other rows gives the second table,
 * which is where the linting engines are actually compared. Both numbers
 * matter — the first is what a pre-commit hook on one small file pays, the
 * second is what a large spec pays.
 *
 * The two presets are **not** the same rules: mjst's `oas` preset enables 53
 * rules (Spectral's recommended set), vacuum's default enables 55 of its own,
 * and vacuum ships rules mjst has no equivalent for (`description-duplication`
 * and `oas3-missing-example` alone account for most of its petstore findings).
 * Both counts are printed so the work each tool did is visible, but this is a
 * throughput comparison, not a parity check.
 *
 * vacuum is not a dependency of this repo — install it (`go install
 * github.com/daveshanley/vacuum@latest`, or `brew install daveshanley/vacuum/vacuum`)
 * and the bench finds it on `PATH`, or point `VACUUM_BIN` at the binary.
 * Without it the bench says so and exits cleanly rather than failing.
 *
 * Run with `bun run bench:vacuum` (or `bun run bench:vacuum:node`) — the
 * runtime running this script is the one that runs the mjst CLI, so both
 * engines get a turn. Paths passed on the command line replace the built-in
 * documents (`bun run bench:vacuum -- ~/openapi.json`), which is how a spec too
 * large to vendor into `fixtures/` gets measured; the startup row stays either
 * way, because the second table is nothing without it.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const FIXTURE_DIR = join(REPO_ROOT, 'fixtures/openapi/real-world')
const CLI_ENTRY = join(REPO_ROOT, 'packages/cli/dist/cli.js')

/**
 * A document both tools lint. `startup` marks the near-empty document whose
 * time is treated as each tool's fixed cost and subtracted from the rest.
 */
type Fixture = { label: string; path: string; startup?: true }

/**
 * A clean, tiny OpenAPI document. It exists to be *boring*: every rule that
 * could fire on it is satisfied, so what remains is the price of starting the
 * tool up. Written to a temp file rather than added to `fixtures/`, where the
 * fixture-driven test suites would pick it up.
 */
const STARTUP_DOCUMENT = `openapi: 3.1.0
info:
  title: Startup
  version: 1.0.0
  description: A deliberately tiny document, used to measure fixed cost.
  contact:
    name: mjst
    url: https://github.com/amritk/mjst
    email: bench@example.com
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT
servers:
  - url: https://example.com
    description: Example
tags:
  - name: things
    description: The things
paths:
  /things:
    get:
      operationId: listThings
      summary: List things
      description: List the things.
      tags: [things]
      responses:
        '200':
          description: A list of things
          content:
            application/json:
              schema:
                type: array
                items:
                  type: string
              example: ['a']
`

/** Mean wall time of one whole CLI invocation, and how many were run to get it. */
type Timing = { meanMs: number; iterations: number }

/**
 * Runs `invoke` once to warm the page cache, once more to size the sample, then
 * reports the mean over roughly `budgetMs`. Process spawns are coarse enough
 * that a handful of iterations settles down; the cap keeps the 2.8 MB document
 * from turning a bench run into a coffee break.
 */
const measure = (invoke: () => void, budgetMs = 4000, maxIterations = 30): Timing => {
  invoke()

  const probeStart = performance.now()
  invoke()
  const single = performance.now() - probeStart

  const iterations = Math.max(3, Math.min(maxIterations, Math.round(budgetMs / Math.max(single, 1))))
  const start = performance.now()
  for (let i = 0; i < iterations; i++) invoke()
  return { meanMs: (performance.now() - start) / iterations, iterations }
}

/**
 * Locates vacuum: `VACUUM_BIN` if set, otherwise whatever `vacuum` resolves to
 * on `PATH`. Returns its version string, or `undefined` when it is not there —
 * `spawnSync` reports a missing binary as `error` rather than throwing.
 */
const findVacuum = (): { bin: string; version: string } | undefined => {
  const bin = process.env['VACUUM_BIN'] ?? 'vacuum'
  const probe = spawnSync(bin, ['version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return undefined
  const version = probe.stdout.trim().split('\n').pop() ?? ''
  return { bin, version }
}

/**
 * The linting run being timed, for each tool. Both are told to skip per-finding
 * output (`--quiet` / `-x`) so the comparison is of the linting rather than of
 * two different report formats; vacuum additionally has its banner and its
 * "is there a newer vacuum?" network call turned off, which would otherwise
 * time an HTTP request.
 */
const mjstArgs = (file: string): string[] => [CLI_ENTRY, 'lint', '--ruleset', 'oas', '--quiet', file]
const vacuumArgs = (file: string): string[] => ['lint', '-x', '-b', '--no-update-check', file]

/**
 * Counts mjst's findings from the summary line it prints when not `--quiet`.
 *
 * The report is captured through a real file rather than a pipe. A spec with a
 * few thousand findings prints more than `spawnSync`'s 1 MB default buffer, and
 * — more to the point — the CLI writes to `process.stdout` and then calls
 * `process.exit`, which drops whatever is still queued when stdout is a pipe.
 * The last line, the summary being read here, is exactly what goes missing. A
 * file descriptor is written synchronously, so nothing is lost.
 */
const countMjst = (file: string, capturePath: string): number => {
  const args = mjstArgs(file).filter((arg) => arg !== '--quiet')
  const capture = openSync(capturePath, 'w')
  try {
    spawnSync(process.execPath, args, { stdio: ['ignore', capture, 'ignore'] })
  } finally {
    closeSync(capture)
  }
  return Number(/✖ (\d+) problem/.exec(readFileSync(capturePath, 'utf8'))?.[1] ?? 0)
}

/**
 * Counts vacuum's findings. `lint -x` prints nothing machine-readable, so this
 * asks for the Spectral-compatible JSON report instead — a separate invocation,
 * outside the timed loop, exactly as the Spectral bench counts separately from
 * timing.
 */
const countVacuum = (bin: string, file: string, reportPath: string): number | undefined => {
  rmSync(reportPath, { force: true })
  spawnSync(bin, ['spectral-report', '--no-update-check', file, reportPath], { stdio: 'ignore' })
  if (!existsSync(reportPath)) return undefined
  const report: unknown = JSON.parse(readFileSync(reportPath, 'utf8'))
  return Array.isArray(report) ? report.length : undefined
}

const pad = (value: string, width: number): string => value.padEnd(width)
const padStart = (value: string, width: number): string => value.padStart(width)

const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`)
const fmtKb = (file: string): string => `${(statSync(file).size / 1024).toFixed(0)} KB`

/**
 * One document's result: both mean times and both finding counts. vacuum's
 * count is `undefined` when its report could not be read, which is printed as a
 * dash rather than as a zero — an unknown count and a clean document are not
 * the same answer.
 */
type Row = {
  label: string
  size: string
  isStartup: boolean
  mjstMs: number
  vacuumMs: number
  mjst: number
  vacuum: number | undefined
}

const header = (first: string): string =>
  `  ${pad(first, 22)}${padStart('size', 9)}${padStart('mjst', 11)}${padStart('vacuum', 11)}${padStart('ratio', 9)}`

const line = (label: string, size: string, mjstMs: number, vacuumMs: number, counts: string): string =>
  `  ${pad(label, 22)}${padStart(size, 9)}${padStart(fmtMs(mjstMs), 11)}${padStart(fmtMs(vacuumMs), 11)}${padStart(`${(vacuumMs / mjstMs).toFixed(2)}x`, 9)}${padStart(counts, 18)}`.trimEnd()

const run = (): void => {
  const vacuum = findVacuum()
  if (!vacuum) {
    console.log('\nvacuum is not installed, so there is nothing to compare against.\n')
    console.log('  go install github.com/daveshanley/vacuum@latest   # or: brew install daveshanley/vacuum/vacuum')
    console.log('  VACUUM_BIN=/path/to/vacuum bun run bench:vacuum   # if it is not on PATH\n')
    return
  }
  if (!existsSync(CLI_ENTRY)) {
    console.log(`\nThe mjst CLI is not built (${CLI_ENTRY} is missing). Run \`bun run build\` from the repo root.\n`)
    return
  }

  // Documents named on the command line replace the built-in ones — you asked
  // about that spec, not about three others first. Checked before anything is
  // created, and a missing one stops the run: quietly benching the built-ins
  // instead would look like success. The startup row always stays, since the
  // second table is nothing without it.
  const named = process.argv.slice(2).map((path): Fixture => {
    const resolved = resolve(path)
    if (!existsSync(resolved)) throw new Error(`No such document: ${resolved}`)
    return { label: basename(resolved), path: resolved }
  })

  const workspace = mkdtempSync(join(tmpdir(), 'mjst-vacuum-bench-'))
  const startupDocument = join(workspace, 'startup.yaml')
  const reportPath = join(workspace, 'vacuum-report.json')
  const capturePath = join(workspace, 'mjst-report.txt')
  writeFileSync(startupDocument, STARTUP_DOCUMENT)

  const builtIn: Fixture[] = [
    { label: 'petstore (Swagger)', path: join(FIXTURE_DIR, 'swagger-petstore.json') },
    { label: 'digitalocean', path: join(FIXTURE_DIR, 'digitalocean.yaml') },
    { label: 'openai', path: join(FIXTURE_DIR, 'openai.yaml') },
  ]

  const fixtures: Fixture[] = [
    { label: 'startup (tiny doc)', path: startupDocument, startup: true },
    ...(named.length > 0 ? named : builtIn),
  ]

  const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`
  console.log('\n=== mjst lint vs vacuum — recommended OpenAPI ruleset, CLI to CLI ===\n')
  console.log(`mjst CLI on ${runtime}   vacuum ${vacuum.version}`)
  console.log('Every figure is a whole process: start → load → build ruleset → parse → resolve $refs → run rules.')
  console.log(
    'The presets are not the same rules (mjst 53, vacuum 55), so the finding counts are context, not parity.\n',
  )

  const rows: Row[] = []
  for (const { label, path, startup } of fixtures) {
    const mjst = measure(() => void spawnSync(process.execPath, mjstArgs(path), { stdio: 'ignore' }))
    const vac = measure(() => void spawnSync(vacuum.bin, vacuumArgs(path), { stdio: 'ignore' }))
    rows.push({
      label,
      size: fmtKb(path),
      isStartup: startup === true,
      mjstMs: mjst.meanMs,
      vacuumMs: vac.meanMs,
      mjst: countMjst(path, capturePath),
      vacuum: countVacuum(vacuum.bin, path, reportPath),
    })
  }

  console.log(`${header('document')}${padStart('findings m/v', 18)}`)
  for (const row of rows) {
    console.log(line(row.label, row.size, row.mjstMs, row.vacuumMs, `${row.mjst} / ${row.vacuum ?? '—'}`))
  }

  // Startup is a flat cost each tool pays once per file. Taking it off both
  // sides leaves the part that scales with the document — the linting itself.
  const startup = rows.find((row) => row.isStartup)
  if (startup) {
    console.log(
      `\n  minus each tool's own startup (mjst ${fmtMs(startup.mjstMs)}, vacuum ${fmtMs(startup.vacuumMs)}):\n`,
    )
    console.log(header('document'))
    for (const row of rows.filter((candidate) => candidate !== startup)) {
      const mjstMs = Math.max(row.mjstMs - startup.mjstMs, 0.1)
      const vacuumMs = Math.max(row.vacuumMs - startup.vacuumMs, 0.1)
      console.log(line(row.label, row.size, mjstMs, vacuumMs, ''))
    }
  }

  console.log('\n  ratio is vacuum ÷ mjst mean wall time; above 1.00x means mjst finished first.\n')
  rmSync(workspace, { recursive: true, force: true })
}

run()
