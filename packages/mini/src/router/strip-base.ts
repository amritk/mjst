/**
 * Removes a configured base prefix from a pathname before route matching, so
 * route patterns stay written relative to the app's mount point (history mode).
 *
 * The prefix is only stripped when it lands on a path boundary: `/app` strips
 * from `/app/users` (→ `/users`) and from `/app` itself (→ `/`), but not from
 * `/application`, where `/app` is a coincidental character prefix rather than a
 * real segment. A pathname that does not start with the base is returned
 * untouched.
 */
export const stripBase = (pathname: string, base: string): string => {
  if (base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length)
    return rest.startsWith('/') || rest === '' ? rest || '/' : pathname
  }
  return pathname
}
