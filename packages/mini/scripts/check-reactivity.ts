/**
 * check-reactivity — a guard for mini's one compilerless-JSX footgun.
 *
 * mini decides reactivity by VALUE SHAPE at runtime: a function-valued prop or
 * child is a live binding; anything else is applied once and frozen. Calling a
 * signal inside JSX (`disabled={streaming()}`) hands the runtime a plain value,
 * so the attribute never updates again — the single mistake this checker exists
 * to catch. The fix is to pass the signal itself (`disabled={streaming}`) or a
 * thunk (`{() => streaming() ? 'on' : 'off'}`).
 *
 * Why a textual scan rather than a full TypeScript AST pass: the footgun has a
 * crisp, unambiguous signature — the call is the ENTIRE brace content. An arrow
 * body always contains `=>`, and any larger expression contains more than the
 * call, so `={sig()}` / `{sig()}` (nothing else between the braces) cannot be
 * confused with the correct forms. That keeps this a zero-dependency script that
 * runs identically under bun, node, and CI, with effectively no false positives.
 *
 * A signal is any local declared `const x = signal(...)` / `computed(...)`, or a
 * binding annotated `Signal<…>` / `ReadonlySignal<…>`. Suppress a deliberate
 * static read with a `// mini-static-ok` comment on the same line.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** One flagged call: a signal read directly inside a JSX attribute or child. */
export type ReactivityFinding = {
  file: string
  line: number
  column: number
  /** The attribute the frozen value was bound to, or `'children'` for a child expression. */
  target: string
  /** The signal whose call froze the value. */
  signal: string
  message: string
}

const OPT_OUT = 'mini-static-ok'
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Collects the names that behave as signals in one source file: locals bound to
 * `signal(...)` / `computed(...)`, and identifiers annotated `Signal<…>` or
 * `ReadonlySignal<…>` (parameters, fields, variables). Names are gathered
 * file-wide — a heuristic, not scope-accurate, which is why the `mini-static-ok`
 * escape hatch exists for the rare collision.
 */
const collectSignalNames = (source: string): Set<string> => {
  const names = new Set<string>()
  const declared = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:signal|computed)\s*[<(]/g
  const typed = /([A-Za-z_$][\w$]*)\s*:\s*(?:Readonly)?Signal\s*</g
  for (const match of source.matchAll(declared)) names.add(match[1] as string)
  for (const match of source.matchAll(typed)) names.add(match[1] as string)
  return names
}

/** Turns a character offset into 1-based line/column for editor-clickable output. */
const positionAt = (source: string, index: number): { line: number; column: number } => {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: index - lineStart + 1 }
}

/** Whether the line containing `index` opts out via a `// mini-static-ok` comment. */
const isSuppressed = (source: string, index: number): boolean => {
  const lineEnd = source.indexOf('\n', index)
  const line = source.slice(source.lastIndexOf('\n', index) + 1, lineEnd === -1 ? undefined : lineEnd)
  return line.includes(OPT_OUT)
}

/**
 * Scans one `.tsx` source for signals read directly inside JSX. Returns a
 * finding per frozen binding; an empty array means the file is clean.
 */
export const scanSource = (file: string, source: string): ReactivityFinding[] => {
  const signals = collectSignalNames(source)
  if (signals.size === 0) return []

  const findings: ReactivityFinding[] = []
  for (const signal of signals) {
    const name = escapeRegex(signal)
    // `attr={signal()}` — the call is the whole attribute value. `on*` handlers
    // are excluded: a bare call there is not the reactivity footgun.
    const attribute = new RegExp(`([A-Za-z_$][\\w$-]*)=\\{\\s*${name}\\(\\)\\s*\\}`, 'g')
    for (const match of source.matchAll(attribute)) {
      const target = match[1] as string
      if (target.startsWith('on')) continue
      if (isSuppressed(source, match.index)) continue
      const { line, column } = positionAt(source, match.index)
      findings.push({
        file,
        line,
        column,
        target,
        signal,
        message: `${target}={${signal}()} freezes the value at creation. Bind live with ${target}={${signal}} (or a thunk ${target}={() => ${signal}()}).`,
      })
    }
    // `>{signal()}<` — the call is the whole child expression. The `>` (or `}`
    // from a sibling expression) before `{` rules out `attr={signal()}`, already
    // reported above, and any arrow body (which contains `=>`).
    const child = new RegExp(`[>}]\\s*\\{\\s*${name}\\(\\)\\s*\\}`, 'g')
    for (const match of source.matchAll(child)) {
      if (isSuppressed(source, match.index)) continue
      const { line, column } = positionAt(source, match.index)
      findings.push({
        file,
        line,
        column,
        target: 'children',
        signal,
        message: `{${signal}()} renders static text. Bind live with a thunk {() => ${signal}()}.`,
      })
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column)
}

/** Recursively collects `.tsx` files under `dir`, skipping `node_modules`/`dist`. */
const collectTsxFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectTsxFiles(full))
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** CLI: scan the paths in `argv` (files or dirs), print findings, exit non-zero if any. */
export const run = (argv: string[]): number => {
  const roots = argv.length > 0 ? argv : ['src']
  const files = roots.flatMap((root) => (statSync(root).isDirectory() ? collectTsxFiles(root) : [root]))
  const findings = files.flatMap((file) => scanSource(file, readFileSync(file, 'utf8')))
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}:${finding.column}  ${finding.message}`)
  }
  if (findings.length > 0) {
    console.error(
      `\n${findings.length} reactivity issue(s) found. Suppress a deliberate static read with // ${OPT_OUT}.`,
    )
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(run(process.argv.slice(2)))
