import { createBoundedCache } from './bounded-cache'

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

/** Finds the index of the `}` closing the `{` at `open`, or -1 when it is unbalanced. */
const findBraceEnd = (glob: string, open: number): number => {
  let depth = 0
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++
    else if (glob[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Compiles a glob into an un-anchored RegExp source.
 *
 * Brace alternations become a regex group (`a.{yaml,yml}` → `a\.(?:yaml|yml)`)
 * rather than being expanded into concrete globs. Expansion used to build the
 * cartesian product of every group, which is exponential in the number of them:
 * `'{a,b}'.repeat(22)` — a 110-character `files` entry in a ruleset — spent 40
 * seconds producing a 96 MB regex source. A group compiles in place, so the
 * output stays linear in the pattern's length.
 *
 * `braces` is false inside a group that has no top-level comma: such a group is
 * literal (mirroring minimatch), so `{}` in a path does not vanish and nothing
 * nested inside it alternates either.
 */
const globSource = (glob: string, braces: boolean): string => {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '{' && braces) {
      const close = findBraceEnd(glob, i)
      // An unbalanced `{` means no group here (nor anywhere after it): the rest
      // of the pattern is matched literally, brace characters included.
      if (close === -1) return source + globSource(glob.slice(i), false)
      const body = glob.slice(i + 1, close)
      const options = splitTopLevel(body)
      if (options.length === 1) {
        // No alternation — keep the braces as literal characters.
        source += `\\{${globSource(body, false)}\\}`
        i = close
        continue
      }
      // A `/` right after the group is folded into every option instead of
      // being emitted after it. `**` only collapses to `(?:.*/)?` when it can
      // see the slash that follows, and compiling each option in isolation
      // hides it — so `{**,dist}/x.yaml` produced `(?:.*|dist)/x\.yaml`, which
      // demands a slash and no longer matched `x.yaml`, though the expansion
      // this replaced (`**/x.yaml`) did. Folding gives each option its own
      // answer: `**/` collapses, `dist/` keeps its literal slash.
      const followedBySlash = glob[close + 1] === '/'
      const compile = (option: string): string => globSource(followedBySlash ? `${option}/` : option, true)
      source += `(?:${options.map(compile).join('|')})`
      i = followedBySlash ? close + 1 : close
      continue
    }
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
// Bounded like the engine's other memoization maps: the keys come from rulesets,
// and a long-lived service taking a ruleset per request would otherwise grow this
// map for the life of the process.
const regexCache = createBoundedCache<string, RegExp>(500)

/** Compiles a glob pattern (`**`, `*`, `?`, `{a,b}`) into an anchored RegExp, cached by string. */
export const globToRegExp = (glob: string): RegExp => {
  const cached = regexCache.get(glob)
  if (cached) return cached
  const regex = new RegExp(`^(?:${globSource(glob, true)})$`)
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
