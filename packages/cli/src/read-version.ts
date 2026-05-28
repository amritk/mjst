import { readFile } from 'node:fs/promises'

/**
 * Reads the CLI's own version from its `package.json`.
 *
 * Resolved relative to this module so it works whether the code runs from
 * `src/` (dev) or the bundled `dist/cli.js` (published) — `package.json`
 * sits one directory above both.
 */
export const readVersion = async (): Promise<string> => {
  const pkgUrl = new URL('../package.json', import.meta.url)
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf-8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}
