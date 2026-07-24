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
 * It walks the TypeScript AST and flags a zero-argument call to a *signal*
 * anywhere inside an attribute or child value that is not itself a function —
 * the whole-value case `disabled={streaming()}` / `<span>{count()}</span>`, and
 * also the sub-expression freezes that trip people up just as often:
 * `class={active() ? 'on' : 'off'}`, `disabled={busy() || locked}`,
 * `style={{ width: w() }}`, `` title={`${count()} left`} ``. Every one of those
 * calls the signal at the JSX call site and hands the runtime a frozen value.
 *
 * To keep false positives near zero it only flags calls to names it can see are
 * signals: a local `const x = signal(...)` / `computed(...)`, or a binding typed
 * `Signal<…>` / `ReadonlySignal<…>` (variable, parameter, or property). A
 * one-shot helper like `id={makeId()}` is therefore left alone. The correct
 * forms never match: a bare getter `attr={signal}` has no call, and a thunk,
 * handler, or `.map` callback wraps the call in an arrow — the scanner stops at
 * every `=>`/`function` boundary, so a signal read inside a getter is exactly
 * the reactive form and is not flagged. Because the parser does the work,
 * comments and strings cannot trip the scanner and multi-line attributes are
 * found.
 *
 * This is the shared core behind both adapters — the Vite plugin
 * ({@link catchCalledSignals}) that reports live in the dev server, and the
 * repo's CLI gate. When a read is deliberately static, mark the line (or the
 * line above) with a `// mini-static-ok` comment and it is skipped.
 */

/** A single suspicious `{signal()}` binding, with a 1-based source position. */
export type CalledSignalBinding = {
  /**
   * The JSX attribute name (`disabled`) for an attribute binding, or `undefined`
   * when the call is a JSX child — `<span>{count()}</span>` — which has no
   * attribute name. A child freezes just like an attribute: a bare `{count}`
   * child is already reactive (mini wraps function children in an effect), so
   * `{count()}` is the frozen mistake.
   */
  readonly attribute?: string
  /** The signal that was called, e.g. `streaming`. */
  readonly callee: string
  /** 1-based line of the binding, for a `file:line:col` report. */
  readonly line: number
  /** 1-based column of the binding. */
  readonly column: number
}

/** The opt-out marker, checked on the finding's own line or the line above. */
const IGNORE = 'mini-static-ok'

/** Whether a type annotation is `Signal<…>` or `ReadonlySignal<…>`. */
const isSignalType = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined &&
  ts.isTypeReferenceNode(type) &&
  ts.isIdentifier(type.typeName) &&
  (type.typeName.text === 'Signal' || type.typeName.text === 'ReadonlySignal')

/** Whether an initializer is a `signal(...)` or `computed(...)` call. */
const isSignalFactory = (init: ts.Expression | undefined): boolean =>
  init !== undefined &&
  ts.isCallExpression(init) &&
  ts.isIdentifier(init.expression) &&
  (init.expression.text === 'signal' || init.expression.text === 'computed')

/**
 * The names that behave as signals in one file: locals bound to
 * `signal(...)` / `computed(...)`, and identifiers annotated `Signal<…>` /
 * `ReadonlySignal<…>` (variables, parameters, properties). This is a file-wide
 * heuristic rather than scope-accurate resolution — which is why the
 * `mini-static-ok` escape hatch exists for the rare name collision.
 */
const collectSignalNames = (sourceFile: ts.SourceFile): Set<string> => {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (isSignalFactory(node.initializer) || isSignalType(node.type))
    ) {
      names.add(node.name.text)
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name) && isSignalType(node.type)) {
      names.add(node.name.text)
    } else if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      isSignalType(node.type)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

/** Finds every `attr={signal()}` and `{signal()}`-child binding in a `.tsx` source string. */
export const findCalledSignalBindings = (source: string): readonly CalledSignalBinding[] => {
  const sourceFile = ts.createSourceFile('scan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const signals = collectSignalNames(sourceFile)
  if (signals.size === 0) return []

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

  // Collects zero-arg calls to known signals within an expression, stopping at
  // any function boundary — a call inside an arrow/`function` is the reactive
  // getter form and must not be flagged.
  const collectCalls = (expr: ts.Node): ts.CallExpression[] => {
    const found: ts.CallExpression[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        ts.isIdentifier(node.expression) &&
        signals.has(node.expression.text)
      ) {
        found.push(node)
      }
      ts.forEachChild(node, walk)
    }
    walk(expr)
    return found
  }

  const visit = (node: ts.Node): void => {
    // A `{…}` in JSX is a `JsxExpression`; its parent tells us whether it is an
    // attribute value or a child. Both freeze a called signal identically.
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const value = node.expression
      const parent = node.parent
      const isAttribute = ts.isJsxAttribute(parent) && ts.isIdentifier(parent.name)
      const attribute = isAttribute ? (parent.name as ts.Identifier).text : undefined
      const isChild = ts.isJsxElement(parent) || ts.isJsxFragment(parent)
      // `onClick`/`onInput`… are event slots, not reactive bindings — a bare
      // call there is a different mistake, left to the runtime. Match the real
      // handler shape (`on` + capital) so props like `once`/`online` are spared.
      const isEventHandler = attribute !== undefined && /^on[A-Z]/.test(attribute)
      // A function-valued attribute/child is the correct reactive form — the
      // call lives inside the getter mini runs — so it is never flagged.
      const isGetter = ts.isArrowFunction(value) || ts.isFunctionExpression(value)
      if ((isAttribute || isChild) && !isEventHandler && !isGetter) {
        // The whole value being one bare call anchors on the attribute/child for
        // a stable report; a sub-expression freeze anchors on the offending call.
        const wholeValueCall =
          ts.isCallExpression(value) &&
          value.arguments.length === 0 &&
          ts.isIdentifier(value.expression) &&
          signals.has(value.expression.text)
        if (wholeValueCall) {
          const callee = (value.expression as ts.Identifier).text
          if (isAttribute) record(parent, callee, attribute)
          else record(node, callee)
        } else {
          for (const call of collectCalls(value)) record(call, (call.expression as ts.Identifier).text, attribute)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return bindings
}
