import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * True when `filename` resolves to a path inside `directory`.
 *
 * The filenames come from the schema, so they are input: `../../etc/passwd` and
 * `/etc/passwd` have to be refused before anything is written. This asks only
 * where the write lands — a path that climbs out and back in (`../out/a.md`)
 * does land inside, and what makes that one unacceptable is the page it
 * collides with, which the page model settles first.
 *
 * The climb is tested by path *segment*. A string-prefix test refused the
 * ordinary file name `..extra.md`, which lives exactly where it says it does.
 */
export const isInsideDirectory = (directory: string, filename: string): boolean => {
  if (filename.length === 0 || isAbsolute(filename)) return false
  const inside = relative(resolve(directory), resolve(directory, filename))
  if (inside.length === 0) return false
  if (isAbsolute(inside)) return false
  // Both separators are checked: `sep` is what this platform produces, and `/`
  // is what a schema writes whatever platform reads it.
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !inside.startsWith('../')
}
