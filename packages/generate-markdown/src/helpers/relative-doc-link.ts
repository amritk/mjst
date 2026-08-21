/**
 * Builds the relative link from one generated page to another. Pages are
 * addressed by their output-relative path (`guides/typescript.md`), so a link
 * between two of them has to be resolved against the linking page's own
 * directory — `../configuration.md` from inside `guides/`, plain
 * `guides/typescript.md` from the root.
 *
 * Plain string work rather than `node:path`, so the renderers stay usable
 * anywhere (a browser playground included) and always emit posix separators.
 */
export const relativeDocLink = (fromFile: string, toFile: string): string => {
  const from = fromFile.split('/').slice(0, -1)
  const to = toFile.split('/')
  const target = to.pop() ?? ''
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++
  const up = Array.from({ length: from.length - shared }, () => '..')
  const down = to.slice(shared)
  const segments = [...up, ...down, target]
  // A sibling page needs the explicit `./` as little as a nested one needs it,
  // but a bare `typescript.md` is a valid relative link everywhere, so leave it.
  return segments.join('/')
}
