/**
 * Escapes a derived name for use inside a `RegExp`.
 *
 * The names `refToName` builds are identifier characters plus whatever the
 * caller's `typeSuffix` adds, and that suffix is a plain string nobody validates
 * — a `.` or a `+` in one would otherwise be read as regex syntax and match the
 * wrong text.
 */
const escapeForWordMatch = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Removes the parts of generated TypeScript that carry author data rather than
 * code: comments, and single- or double-quoted string literals.
 *
 * Both are full of text the generator copied out of the schema — a JSDoc block
 * is the `description` verbatim, and a validator's error messages name
 * properties and quote values. A definition called `Link` or `Schema` turns any
 * prose mentioning it into a false "this name is used", and the import kept on
 * that evidence is unused, which is `TS6133` in the consumer's build.
 *
 * Template literals are left in place: in emitted code the backtick is a
 * template literal *type* (`` `x-${string}` ``), which is syntax, not data.
 */
const stripDataText = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')

/**
 * Asks whether emitted source names an identifier — the question that decides
 * which `$ref` imports a generated file actually needs.
 *
 * Deciding it from the text rather than from a second walk over the schema is
 * what keeps the import list in step with whatever the type and function
 * emitters chose to write: a `$ref` in a position the type emitter does not read
 * is called and never named, one it inlines through is named in a file that
 * never walked into it, and a ref inside a folded-away branch is neither.
 *
 * The remaining inexactness is the harmless direction — a name spelled in code
 * that is not a reference to the import keeps a binding that could have gone.
 */
export const identifierMentions = (source: string): ((name: string) => boolean) => {
  const code = stripDataText(source)
  return (name: string): boolean => new RegExp(`\\b${escapeForWordMatch(name)}\\b`).test(code)
}
