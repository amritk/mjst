/**
 * Minimal glob → RegExp for matching override `files` patterns against document
 * paths. Supports `**` (any path segments), `*` (within a segment), `?`, and
 * brace expansion (`{a,b}`).
 */
const REGEXP_SPECIAL = /[\\^$.*+?()[\]{}|/]/

/** Splits brace-group content on top-level commas (commas nested in inner braces stay put). */
const splitTopLevel = (body: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

/**
 * Expands brace alternations (`a.{yaml,yml}` → `a.yaml`, `a.yml`) into concrete
 * globs, cartesian across multiple groups. A group with no top-level comma is
 * left literal (mirroring minimatch), so `{}` in a path does not vanish.
 */
const expandBraces = (glob: string): string[] => {
  const open = glob.indexOf('{')
  if (open === -1) return [glob]
  let depth = 0
  let close = -1
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++
    else if (glob[i] === '}') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) return [glob]
  const prefix = glob.slice(0, open)
  const body = glob.slice(open + 1, close)
  const suffix = glob.slice(close + 1)
  const options = splitTopLevel(body)
  if (options.length === 1) {
    // No alternation — keep the braces as literal characters.
    return expandBraces(suffix).map((rest) => `${prefix}{${body}}${rest}`)
  }
  const results: string[] = []
  for (const option of options) {
    for (const expandedOption of expandBraces(option)) {
      for (const expandedSuffix of expandBraces(suffix)) {
        results.push(prefix + expandedOption + expandedSuffix)
      }
    }
  }
  return results
}

/** Compiles a single (brace-free) glob into an un-anchored RegExp source. */
const globInnerSource = (glob: string): string => {
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
  return source
}

// Compiled patterns are cached by their glob string; the ruleset's override
// globs are re-tested against every linted source, so compiling once matters.
const regexCache = new Map<string, RegExp>()

/** Compiles a glob pattern (`**`, `*`, `?`, `{a,b}`) into an anchored RegExp, cached by string. */
export const globToRegExp = (glob: string): RegExp => {
  const cached = regexCache.get(glob)
  if (cached) return cached
  const alternatives = expandBraces(glob).map(globInnerSource)
  const regex = new RegExp(`^(?:${alternatives.join('|')})$`)
  regexCache.set(glob, regex)
  return regex
}

/** Returns true if `path` matches any of the glob patterns. */
export const matchesGlob = (path: string, patterns: string[]): boolean => {
  const basename = path.split('/').pop() ?? path
  return patterns.some((pattern) => {
    const regex = globToRegExp(pattern)
    if (regex.test(path)) return true
    // A pattern without a slash also matches the basename.
    if (!pattern.includes('/')) return regex.test(basename)
    // A relative pattern that contains a slash matches an absolute source by
    // suffix, so `src/api.yaml` matches `/home/user/repo/src/api.yaml` — the
    // minimatch/Spectral behavior for override globs against absolute paths.
    if (!pattern.startsWith('/') && !pattern.startsWith('**')) {
      return globToRegExp(`**/${pattern}`).test(path)
    }
    return false
  })
}
