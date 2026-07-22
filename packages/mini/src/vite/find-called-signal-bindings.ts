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
 * This is the shared core behind both adapters — the Vite plugin
 * ({@link catchCalledSignals}) that reports live in the dev server, and the
 * repo's CLI gate. When a call is deliberate — a test that demonstrates the
 * frozen behaviour, or a genuinely one-shot value — put
 * `catch-called-signals-ignore` in a comment on the same line or the line
 * above and the binding is skipped.
 */

/** A single suspicious `{callee()}` binding, with a 1-based source position. */
export type CalledSignalBinding = {
  /**
   * The JSX attribute name (`disabled`) for an attribute binding, or `undefined`
   * when the call is a JSX child — `<span>{count()}</span>` — which has no
   * attribute name. A child freezes just like an attribute: a bare `{count}`
   * child is already reactive (mini wraps function children in an effect), so
   * `{count()}` is the frozen mistake.
   */
  readonly attribute?: string
  /** The reference that was called, e.g. `streaming` or `form.isSubmitting`. */
  readonly callee: string
  /** 1-based line of the binding, for a `file:line:col` report. */
  readonly line: number
  /** 1-based column of the binding. */
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

/** Finds every `attr={callee()}` and `{callee()}`-child binding in a `.tsx` source string. */
export const findCalledSignalBindings = (source: string): readonly CalledSignalBinding[] => {
  const sourceFile = ts.createSourceFile('scan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines = source.split('\n')
  const bindings: CalledSignalBinding[] = []

  // Records a finding unless its line (or the line above) carries the opt-out
  // marker. `anchor` decides where we point — the attribute for a prop, the
  // whole `{…}` for a child — so the report lands on the offending token.
  const record = (anchor: ts.Node, callee: string, attribute?: string): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(anchor.getStart(sourceFile))
    // `line` is 0-based, so `lines[line]` is the binding's own line.
    if (lines[line]?.includes(IGNORE) || lines[line - 1]?.includes(IGNORE)) return
    const position = { line: line + 1, column: character + 1 }
    bindings.push(attribute === undefined ? { callee, ...position } : { attribute, callee, ...position })
  }

  const visit = (node: ts.Node): void => {
    // A `{…}` in JSX is a `JsxExpression`; its parent tells us whether it is an
    // attribute value or a child. Both freeze a called signal identically.
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const value = node.expression
      if (ts.isCallExpression(value) && value.arguments.length === 0) {
        const callee = readCallee(value.expression, sourceFile)
        if (callee !== undefined) {
          const parent = node.parent
          if (ts.isJsxAttribute(parent)) record(parent, callee, parent.name.getText(sourceFile))
          else if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) record(node, callee)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return bindings
}
