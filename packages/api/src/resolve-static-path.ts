/**
 * How {@link resolveStaticPath} treats a segment beginning with a dot.
 * Denying by default is the whole point: a document root checked into a repo
 * routinely sits next to `.env`, `.git`, and `.htpasswd`, and serving those is
 * the classic way a static mount turns into a credential leak.
 */
export type DotfilePolicy = 'deny' | 'allow'

/**
 * Inputs for {@link resolveStaticPath}.
 */
export type ResolveStaticPathOptions = {
  /** The URL pathname, still percent-encoded, exactly as it arrived. */
  readonly pathname: string
  /** The prefix this static root answers under, e.g. `/assets`. */
  readonly prefix: string
  /** The document root files are read from, e.g. `./public`. */
  readonly root: string
  /** What to do with a segment starting with `.`. Defaults to `'deny'`. */
  readonly dotfiles?: DotfilePolicy
}

/**
 * Resolves a request pathname to a path inside `root`, or `undefined` when the
 * request does not belong to this root or is trying to escape it.
 *
 * This is the security-critical half of static serving, kept pure and separate
 * so it can be tested exhaustively. Containment is guaranteed *by
 * construction* rather than by comparing a resolved path against the root
 * afterwards: every segment is decoded and then individually rejected if it
 * could mean anything other than "one directory down". Nothing is ever joined
 * that could climb.
 *
 * The escape this exists to stop is not hypothetical, and it is not the one
 * people check for. A client cannot send a literal `..` segment — every HTTP
 * client and proxy normalizes those away before the request leaves — so a
 * naive `if (path.includes('..'))` looks like it passes its own tests. The
 * live attack is percent-encoded: `/assets/%2e%2e%2f%2e%2e%2fetc/passwd`
 * survives normalization intact, and any code that decodes the tail *before*
 * splitting it hands `../../etc/passwd` straight to the filesystem. So the
 * order here is load-bearing: split first, decode each segment second, judge
 * third. A `%2f` that decodes into a separator is rejected for the same
 * reason — after decoding it is no longer one segment.
 *
 * What this cannot see is a symlink inside the root pointing outside it: that
 * needs a `realpath` call, which means filesystem access this function
 * deliberately does not have. Keep the document root free of symlinks you
 * would not serve.
 *
 * @example
 * ```typescript
 * resolveStaticPath({ pathname: '/assets/app.css', prefix: '/assets', root: './public' })
 * // → './public/app.css'
 * resolveStaticPath({ pathname: '/assets/%2e%2e%2fetc/passwd', prefix: '/assets', root: './public' })
 * // → undefined
 * ```
 */
export const resolveStaticPath = (options: ResolveStaticPathOptions): string | undefined => {
  const { pathname, prefix, root } = options
  const dotfiles = options.dotfiles ?? 'deny'

  if (!pathname.startsWith(prefix)) return undefined
  const rest = pathname.slice(prefix.length)
  // The prefix has to end at a segment boundary, or `/assets-private/secret`
  // would be served out of the `/assets` root.
  if (rest !== '' && !rest.startsWith('/')) return undefined

  const safe: string[] = []
  for (const encoded of rest.split('/')) {
    // Empty segments are the leading slash and any `//` a client collapsed
    // badly; both mean "no segment here", not "the parent".
    if (encoded === '') continue

    let segment: string
    try {
      segment = decodeURIComponent(encoded)
    } catch {
      // A malformed escape (`%zz`) is never a file anyone meant to ask for.
      return undefined
    }

    // Everything below is a segment that, after decoding, no longer means one
    // level down: the parent, the current directory, an embedded separator
    // from `%2f` or `%5c`, or a NUL that truncates the path in a C-backed
    // filesystem call.
    if (segment === '.' || segment === '..') return undefined
    if (segment.includes('/') || segment.includes('\\')) return undefined
    if (segment.includes('\0')) return undefined
    if (dotfiles === 'deny' && segment.startsWith('.')) return undefined

    safe.push(segment)
  }

  if (safe.length === 0) return undefined

  const base = root.endsWith('/') ? root.slice(0, -1) : root
  return `${base}/${safe.join('/')}`
}
