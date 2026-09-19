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

    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{' || char === '[' || char === '(') depth++
    else if (char === '}' || char === ']' || char === ')') depth--
    else if (char === ';' && depth === 0) return i + 1
  }

  return -1
}

/**
 * Rewrites one relative import so it points at the parser half of that module.
 *
 * A parser file importing a `$ref` target wants three things from it, and after
 * the split they live in two files: the *type* stays on the validator side
 * (`./inner.js`), while `parseInner` and `validateInnerShape` move to the parser
 * side (`./inner.parse.js`). Leaving the import alone would point the value names
 * at a module that no longer exports them.
 */
const rehomeImport = (statement: string, suffix: string): string[] => {
  const match = /^import\s+\{([^}]*)\}\s+from\s+'\.\/([^']+)\.js';?$/.exec(statement.trim())
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
  if (types.length > 0) lines.push(`import type { ${types.join(', ')} } from './${module}.js';`)
  if (values.length > 0) lines.push(`import { ${values.join(', ')} } from './${module}${suffix}.js';`)
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
export const rehomeParserFile = (source: string, moduleName: string, suffix: string): string => {
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
    .flatMap((line) => (line.startsWith('import ') && line.includes("from './") ? rehomeImport(line, suffix) : [line]))

  // The declarations that just left were readers too. A `$ref`'s *type* is
  // typically named by the removed `export type Doc = { r?: Inner }` and by
  // nothing else, so its import is now unused — `TS6133` in the consumer's build,
  // which is the one place this package must never be the cause.
  const body = rehomed.filter((line) => !line.startsWith('import ')).join('\n')
  const mentions = identifierMentions(body)
  const kept = rehomed.filter((line) => !line.startsWith('import ') || importIsRead(line, mentions))

  return `import type { ${declared.join(', ')} } from './${moduleName}.js';\n${kept.join('\n')}`
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
