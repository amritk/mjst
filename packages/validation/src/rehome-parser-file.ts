/**
 * Both generators emit their own `export type X = …` for a schema, and both emit
 * the identical text for it — they call the same
 * `@amritk/helpers/generate-type-definition`. That is what makes one output
 * directory possible rather than the two side-by-side trees the CLI settles for:
 * the type is declared once, on the validator side, and the parser side imports
 * it.
 *
 * This is the surgery that does it. It is text on generated text, which is worth
 * being uncomfortable about, so it is one small file with its own tests rather
 * than a few lines buried in the composer.
 */

import { identifierMentions } from '@amritk/helpers/identifier-mentions'

/**
 * The end of the `export type <Name> = …;` declaration starting at `start`, or
 * `-1` when the text does not hold one.
 *
 * Scanning with a brace counter rather than matching a pattern, because the
 * declaration's body is arbitrary TypeScript: an object type closes on `};`, a
 * scalar root (`export type Doc = string;`) on the first `;`, and a union of
 * object members has semicolons inside braces that a lazy pattern would stop at.
 * String literals in the body (an `enum` turned into `"a" | "b"`) can hold either
 * character, so they are skipped rather than counted.
 *
 * So are comments, and they have to be skipped before quotes are looked for: a
 * member's JSDoc is the schema's `description` verbatim, and an apostrophe in
 * prose (`the model's limit`) read as an opening quote swallowed the braces that
 * followed, ended the declaration at a `;` inside it, and left the rest of the
 * body behind as a stray `};` the file then failed to parse on.
 */
const declarationEnd = (source: string, start: number): number => {
  let depth = 0
  let quote: string | null = null

  for (let i = start; i < source.length; i++) {
    const char = source[i]

    if (quote !== null) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      if (close === -1) return -1
      i = close + 1
    } else if (char === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i + 2)
      if (newline === -1) return -1
      i = newline
    } else if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{' || char === '[' || char === '(') depth++
    else if (char === '}' || char === ']' || char === ')') depth--
    else if (char === ';' && depth === 0) return i + 1
  }

  return -1
}

/**
 * An import of a sibling module, recognised without ever writing the specifier
 * prefix as a string.
 *
 * This is a regex rather than the obvious `line.includes("from './")` because
 * the build rewrites that literal. `tsc-alias -f` scans the compiled output for
 * import specifiers to resolve, cannot tell a string that merely *looks* like
 * one from the real thing, and turned `"from './"` into `"from './index.js"` —
 * a predicate that is never true. Nothing failed loudly: every test in this repo
 * aliases workspace packages to `src`, so rehoming worked in the suite and
 * silently stopped happening in the shipped package, which then emitted parser
 * files importing names from the validator file that does not export them.
 *
 * The repo has been here before — a corrupted regex literal shipped
 * `@amritk/generate-parsers@0.12.3` dead on arrival, which is what
 * `scripts/check-publishable.mjs` exists to talk about. The rule this encodes:
 * never spell an import specifier as a plain string literal in code that gets
 * compiled through `tsc-alias`.
 */
const RELATIVE_IMPORT = /^import\s.*\sfrom\s+'\.\.?\//

/**
 * Rewrites one relative import so it points at the parser half of that module.
 *
 * A parser file importing a `$ref` target wants three things from it, and after
 * the split they live in two files: the *type* stays on the validator side
 * (`./inner.js`), while `parseInner` and `validateInnerShape` move to the parser
 * side (`./inner.parse.js`). Leaving the import alone would point the value names
 * at a module that no longer exports them.
 */
const rehomeImport = (statement: string, suffix: string, ext: 'js' | 'ts'): string[] => {
  const match = /^import\s+\{([^}]*)\}\s+from\s+'\.\/([^']+)\.(?:js|ts)';?$/.exec(statement.trim())
  if (!match) return [statement]

  const [, clause = '', module = ''] = match
  // Only a sibling schema module has a parser half to point at. The runtime
  // helper modules (`./_helpers/is-object.js`) keep the one name they were
  // emitted under, so rehoming their import invents a file nobody wrote.
  if (module.includes('/')) return [statement]
  const names = clause
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')

  const types = names.filter((name) => name.startsWith('type ')).map((name) => name.slice('type '.length))
  const values = names.filter((name) => !name.startsWith('type '))

  const lines: string[] = []
  if (types.length > 0) lines.push(`import type { ${types.join(', ')} } from './${module}.${ext}';`)
  if (values.length > 0) lines.push(`import { ${values.join(', ')} } from './${module}${suffix}.${ext}';`)
  return lines
}

/**
 * Strips a generated parser file's own type declarations and points it at the
 * validator file that now owns them.
 *
 * `typeNames` are the types this file declared and must now import — the root
 * type it is named for, and nothing else; a `$ref`'s type was always imported
 * rather than declared, and only needs its import rehomed.
 *
 * Returns the file unchanged when it declares no type at all (an index barrel, a
 * helper module), so the caller can hand it every file without sorting them
 * first.
 */
export const rehomeParserFile = (
  source: string,
  moduleName: string,
  suffix: string,
  ext: 'js' | 'ts' = 'js',
): string => {
  const declared: string[] = []
  let result = source

  // Repeated rather than global-matched: each removal shifts every later offset,
  // so the search restarts against the text as it now stands.
  for (;;) {
    const match = /^export type (\w+) = /m.exec(result)
    if (!match || match.index === undefined) break
    const end = declarationEnd(result, match.index)
    if (end === -1) break
    declared.push(match[1] as string)
    // Take the blank line the declaration sat on with it, so removing it does not
    // leave a growing gap where it was.
    const trailing = result.slice(end).match(/^\n{1,2}/)?.[0] ?? ''
    result = result.slice(0, match.index) + result.slice(end + trailing.length)
  }

  if (declared.length === 0) return source

  const rehomed = result
    .split('\n')
    .flatMap((line) => (RELATIVE_IMPORT.test(line) ? rehomeImport(line, suffix, ext) : [line]))

  // The declarations that just left were readers too. A `$ref`'s *type* is
  // typically named by the removed `export type Doc = { r?: Inner }` and by
  // nothing else, so its import is now unused — `TS6133` in the consumer's build,
  // which is the one place this package must never be the cause.
  const body = rehomed.filter((line) => !line.startsWith('import ')).join('\n')
  const mentions = identifierMentions(body)
  const kept = rehomed.filter((line) => !line.startsWith('import ') || importIsRead(line, mentions))

  return `import type { ${declared.join(', ')} } from './${moduleName}.${ext}';\n${kept.join('\n')}`
}

/** Whether anything outside the import statements still names what it brings in. */
const importIsRead = (statement: string, mentions: (name: string) => boolean): boolean => {
  const match = /\{([^}]*)\}/.exec(statement)
  if (!match) return true
  return (match[1] ?? '')
    .split(',')
    .map((name) => name.trim().replace(/^type\s+/, ''))
    .filter((name) => name !== '')
    .some(mentions)
}
