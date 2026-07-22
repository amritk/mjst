import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * One place a compilerless JSX runtime cannot help you: `@amritk/mini` decides
 * reactivity by value shape at runtime, so `disabled={streaming}` binds live
 * (the getter is passed through) while `disabled={streaming()}` calls the
 * signal first and freezes a plain boolean at creation. The runtime never sees
 * the signal in the second form — the call already happened at the JSX call
 * site — so neither the runtime nor the type checker can catch the mistake
 * (a called signal returns a perfectly valid static value). The only place
 * left to catch it is the source, which is what this scanner does.
 *
 * It walks the TypeScript AST and flags the unambiguous shape: an attribute
 * whose entire value is a single zero-argument call, e.g. `attr={signal()}` or
 * `attr={store.value()}`. That is exactly a frozen signal read. The correct
 * forms are a different node and never match — a bare getter `attr={signal}`
 * has no call, and a thunk or handler `attr={() => signal()}` wraps the call in
 * an arrow, so the attribute's expression is the arrow, not the call. Because
 * the parser is doing the work, comments and strings cannot trip the scanner,
 * multi-line attributes are found, and member/optional-chain callees
 * (`form?.dirty()`) are read precisely.
 *
 * When a call is deliberate — a test that demonstrates the frozen behaviour,
 * or a genuinely one-shot value — put `catch-called-signals-ignore` in a
 * comment on the same line or the line above and the binding is skipped.
 */

/** A single suspicious `attr={callee()}` binding, with a 1-based source position. */
export type CalledSignalBinding = {
  /** The JSX attribute name, e.g. `disabled`. */
  readonly attribute: string
  /** The reference that was called, e.g. `streaming` or `form.isSubmitting`. */
  readonly callee: string
  /** 1-based line of the attribute, for a `file:line:col` report. */
  readonly line: number
  /** 1-based column of the attribute. */
  readonly column: number
}

/** The opt-out marker, checked on the finding's own line or the line above. */
const IGNORE = 'catch-called-signals-ignore'

/**
 * The reference being called, when it is a plain read — a bare signal
 * (`streaming`) or a member access into one (`form.isSubmitting`, and the
 * optional-chain form). Anything else (a call on a call, an element access,
 * an expression) is not the footgun we are after, so it returns `undefined`.
 */
const readCallee = (expression: ts.Expression, source: ts.SourceFile): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.getText(source)
  return undefined
}

/** Finds every `attr={callee()}` binding in a `.tsx` source string. */
export const findCalledSignalBindings = (source: string): readonly CalledSignalBinding[] => {
  const sourceFile = ts.createSourceFile('scan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines = source.split('\n')
  const bindings: CalledSignalBinding[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
      const value = node.initializer.expression
      if (value !== undefined && ts.isCallExpression(value) && value.arguments.length === 0) {
        const callee = readCallee(value.expression, sourceFile)
        if (callee !== undefined) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          // `line` is 0-based, so `lines[line]` is the attribute's own line.
          const suppressed = lines[line]?.includes(IGNORE) || lines[line - 1]?.includes(IGNORE)
          if (suppressed !== true) {
            bindings.push({ attribute: node.name.getText(sourceFile), callee, line: line + 1, column: character + 1 })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return bindings
}

/** Every `.tsx` file under a path, skipping the noise directories a walk hits. */
const collectTsxFiles = async (path: string): Promise<string[]> => {
  const info = await stat(path)
  if (info.isFile()) return path.endsWith('.tsx') ? [path] : []

  const files: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    files.push(...(await collectTsxFiles(join(path, entry.name))))
  }
  return files
}

/**
 * The CLI wrapper. Scans the given files or directories (default: `packages`),
 * prints a `file:line:col` report for each finding, and exits non-zero when any
 * are found so it can gate CI next to `biome check`. Only `.tsx` files are
 * scanned — mini's JSX transform is the only place this footgun can appear.
 */
const main = async (paths: readonly string[]): Promise<number> => {
  const roots = paths.length > 0 ? paths : ['packages']
  let total = 0

  for (const root of roots) {
    for (const file of await collectTsxFiles(root)) {
      const bindings = findCalledSignalBindings(await readFile(file, 'utf-8'))
      for (const { attribute, callee, line, column } of bindings) {
        total += 1
        console.log(
          `${file}:${line}:${column}  ${attribute}={${callee}()} freezes the signal — pass ${attribute}={${callee}} to keep it reactive`,
        )
      }
    }
  }

  console.log(total === 0 ? 'No frozen signal bindings found.' : `Found ${total} frozen signal binding(s).`)
  return total === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
