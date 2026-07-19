import { dirname, relative, sep } from 'node:path'

/**
 * The default `routesImport` specifier: the relative path from the out file's
 * directory to the routes module. The module's real on-disk extension is kept
 * — same convention as the generator's default `--import-ext ts` (see
 * resolve-import-ext.ts): literal paths load under Bun, Node's type
 * stripping, and bundlers alike, whereas an extensionless specifier only
 * resolves through a bundler.
 */
export const defaultRoutesImport = (outFile: string, routesModulePath: string): string => {
  // path.relative speaks the platform separator; import specifiers are always
  // forward-slash.
  const specifier = relative(dirname(outFile), routesModulePath).split(sep).join('/')
  return specifier.startsWith('.') ? specifier : `./${specifier}`
}
