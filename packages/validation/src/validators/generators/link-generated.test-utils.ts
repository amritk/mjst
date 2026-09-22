import { transformSync } from 'esbuild'

/**
 * Compiles and links a whole `buildValidatorSchema` result in memory, returning
 * one named export from it.
 *
 * The generator emits a *set* of files that import each other (`root.ts` pulls
 * `validateFoo` from `./foo.js`, everything pulls the runtime helpers from
 * `./validation-result.js`), so a test that only compiles the root file exercises
 * a fragment of what it actually ships. This transpiles each file to CommonJS and
 * resolves those imports against the generated set — no disk, no bundler.
 *
 * Recursive schemas produce genuinely cyclic modules, so a module is registered
 * *before* its body runs, as a view onto its exports rather than a snapshot of
 * them: esbuild's ESM→CJS wrapper reassigns `module.exports` wholesale, and a
 * snapshot taken beforehand would stay empty. Reads through the view see whatever
 * the module has by the time a validator is actually called, which is all a cycle
 * needs.
 *
 * The `.test-utils.ts` suffix keeps it out of the published build (see
 * `tsconfig.build.json`) since it imports the esbuild devDependency.
 */
export const linkGenerated = <T>(
  files: readonly { readonly filename: string; readonly content: string }[],
  entry: string,
  exportName: string,
): T => {
  const sources = new Map(files.map((file) => [moduleKey(file.filename), file.content]))
  const loaded = new Map<string, Record<string, unknown>>()

  const load = (specifier: string, fromDir: string): Record<string, unknown> => {
    const key = moduleKey(specifier, fromDir)
    const cached = loaded.get(key)
    if (cached !== undefined) return cached
    const source = sources.get(key)
    if (source === undefined) throw new Error(`generated output has no module "${specifier}"`)

    const module = { exports: {} as Record<string, unknown> }
    loaded.set(key, exportsView(module))
    const js = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
    const dir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
    new Function('module', 'exports', 'require', js)(module, module.exports, (nested: string) => load(nested, dir))
    return exportsView(module)
  }

  return load(entry, '')[exportName] as T
}

/**
 * Resolves a specifier to the key its file is registered under: extensions
 * dropped, and a relative import resolved against the importing module's own
 * directory (a helper under `_helpers/` imports its siblings as `./x.js`).
 */
const moduleKey = (specifier: string, fromDir = ''): string => {
  const bare = specifier.replace(/^\.\//, '').replace(/\.(js|ts)$/, '')
  return fromDir === '' ? bare : `${fromDir}/${bare}`
}

/**
 * A live view onto `module.exports` — property reads forward to whatever object
 * `module.exports` currently is, which is what makes a cyclic import work.
 */
const exportsView = (module: { exports: Record<string, unknown> }): Record<string, unknown> =>
  new Proxy({} as Record<string, unknown>, {
    get: (_target, property) => module.exports[property as string],
    has: (_target, property) => property in module.exports,
    ownKeys: () => Reflect.ownKeys(module.exports),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(module.exports, property)
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
    },
  })
