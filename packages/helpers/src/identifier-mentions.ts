/**
 * Escapes a derived name for use inside a `RegExp`.
 *
 * The names `refToName` builds are identifier characters plus whatever the
 * caller's `typeSuffix` adds, and that suffix is a plain string nobody validates
 * — a `.` or a `+` in one would otherwise be read as regex syntax and match the
 * wrong text.
 */
const escapeForWordMatch = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Characters after which a `/` opens a regex literal rather than dividing. */
const BEFORE_REGEX: ReadonlySet<string> = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n'])

/**
 * Blanks out the parts of emitted TypeScript that carry author data rather than
 * code: comments, string and template literals, and regex literals.
 *
 * All of them are full of text the generator copied out of the schema — a JSDoc
 * block is the `description` verbatim, a validator's error messages name
 * properties, and a `pattern` becomes a regex literal. A definition called
 * `Link` or `Schema` turns any prose mentioning it into a false "this name is
 * used", and the import kept on that evidence is unused, which is `TS6133` in
 * the consumer's build.
 *
 * It has to be one scan rather than a sequence of replacements, because these
 * constructs nest in each other's syntax. A `pattern` of `a` slash `*` `b`
 * emits a regex literal whose first two characters open a block comment as far
 * as a comment-stripping pass can tell, and that pass then blanked the rest of
 * the file up to the next comment terminator — dropping the imports every call
 * below it needs. A regex literal carrying an apostrophe does the same to a
 * string-stripping pass, and the media-range format check is one.
 *
 * Each run is replaced by spaces rather than removed so offsets stay put, and
 * an unterminated run answers with the original text: keeping a binding nothing
 * reads costs a lint error, and dropping one the code calls costs a build.
 */
const stripDataText = (source: string): string => {
  // Built from slices of the source and blanked runs rather than by rewriting a
  // character array: generated files run to hundreds of kilobytes, and this runs
  // on every one of them.
  const parts: string[] = []
  let copiedTo = 0
  let previous = '\n'
  let i = 0
  const blank = (from: number, to: number): void => {
    parts.push(source.slice(copiedTo, from), source.slice(from, to).replace(/[^\n]/g, ' '))
    copiedTo = to
  }
  while (i < source.length) {
    const code = source.charCodeAt(i)

    // Everything below opens on `/`, a quote or a backtick; any other character
    // only updates what the last significant one was.
    if (code !== 0x2f && code !== 0x22 && code !== 0x27 && code !== 0x60) {
      if (code === 0x0a) previous = '\n'
      else if (!isWhitespace(code, source, i)) previous = source[i] as string
      i++
      continue
    }

    const char = source[i] as string
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      blank(i, end === -1 ? source.length : end)
      i = end === -1 ? source.length : end
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) return source
      blank(i, end + 2)
      i = end + 2
      previous = ' '
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      let n = i + 1
      while (n < source.length && source[n] !== char) {
        if (source[n] === '\\') n++
        // A quote (not a backtick) never spans a line: an unterminated one is a
        // regex's apostrophe or a stray in prose, not a string.
        if (char !== '`' && source[n] === '\n') return source
        n++
      }
      if (n >= source.length) return source
      blank(i, n + 1)
      i = n + 1
      previous = char
      continue
    }
    if (BEFORE_REGEX.has(previous)) {
      let n = i + 1
      let inClass = false
      while (n < source.length) {
        const c = source[n]
        if (c === '\\') n += 2
        else if (c === '\n') return source
        else if (c === '[') (inClass = true), n++
        else if (c === ']') (inClass = false), n++
        else if (c === '/' && !inClass) break
        else n++
      }
      if (n >= source.length) return source
      // Past the closing slash, the flags.
      let end = n + 1
      while (end < source.length && /[a-z]/.test(source[end] as string)) end++
      blank(i, end)
      i = end
      previous = '/'
      continue
    }

    previous = char
    i++
  }
  parts.push(source.slice(copiedTo))
  return parts.join('')
}

/** `/\s/` for the character at `index`, answered from its code unit when it is ASCII. */
const isWhitespace = (code: number, source: string, index: number): boolean =>
  code < 0x80 ? code === 0x20 || (code >= 0x09 && code <= 0x0d) : /\s/.test(source[index] as string)

/** A name made of word characters only, for which a word-boundary match is a token lookup. */
const WORD_NAME = /^\w+$/

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
  // A file is asked about every `$ref` it might import, several spellings each,
  // and a fresh regex per question rescanned the whole file every time. For a
  // name of word characters, `\bname\b` matches exactly when some maximal run of
  // word characters equals the name, so one pass collecting those runs answers
  // them all. Anything else (a `$`, or punctuation from a `typeSuffix`) keeps
  // the regex, whose boundaries mean something subtler around those characters.
  let words: ReadonlySet<string> | undefined
  return (name: string): boolean => {
    if (!WORD_NAME.test(name)) return new RegExp(`\\b${escapeForWordMatch(name)}\\b`).test(code)
    words ??= new Set(code.match(/\w+/g))
    return words.has(name)
  }
}
