/**
 * Minimal glob → RegExp for matching override `files` patterns against document
 * paths. Supports `**` (any path segments), `*` (within a segment), and `?`.
 */
const REGEXP_SPECIAL = /[\\^$.*+?()[\]{}|/]/

/** Compiles a glob pattern (`**`, `*`, `?`) into an anchored RegExp. */
export const globToRegExp = (glob: string): RegExp => {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else if (char && REGEXP_SPECIAL.test(char)) {
      source += `\\${char}`
    } else {
      source += char
    }
  }
  return new RegExp(`^${source}$`)
}

/** Returns true if `path` matches any of the glob patterns. */
export const matchesGlob = (path: string, patterns: string[]): boolean => {
  const basename = path.split('/').pop() ?? path
  return patterns.some((pattern) => {
    const regex = globToRegExp(pattern)
    if (regex.test(path)) return true
    // A pattern without a slash also matches the basename.
    return !pattern.includes('/') && regex.test(basename)
  })
}
