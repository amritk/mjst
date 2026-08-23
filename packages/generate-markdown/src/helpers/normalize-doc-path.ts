/**
 * Normalizes a generated page path so two spellings of the same file are one
 * file: `a.md`, `./a.md` and `sub/../a.md` all collapse to `a.md`.
 *
 * Without this the duplicate-page guard compared raw strings and let two pages
 * through, and whichever was written second silently replaced the first — the
 * index page could be destroyed by a second page that merely spelled its path
 * differently.
 *
 * A path that climbs above the output directory keeps its leading `..`, so the
 * write guard in `generateDocs` still sees it and refuses.
 */
export const normalizeDocPath = (path: string): string => {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  // A leading slash is kept so an absolute path stays absolute and is refused
  // rather than quietly turned into a relative one.
  return `${path.startsWith('/') ? '/' : ''}${segments.join('/')}`
}
