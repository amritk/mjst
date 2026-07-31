/**
 * Loads a `node:*` built-in on first use, behind a specifier assembled at
 * runtime so no bundler can see it.
 *
 * The package root exports the Node adapters (`toNodeHandler`,
 * `fetchToNodeHandler`) alongside the fetch ones, and the root is what a
 * Cloudflare Workers deployment imports — it is also what `compileToModule`'s
 * emitted module imports by default. A static `import { … } from 'node:http'`
 * anywhere in that graph fails a Workers/browser bundle outright:
 * `esbuild --platform=browser` reports `Could not resolve "node:http"` and
 * stops, and it cannot tree-shake the module away first, because resolution
 * happens before elimination. Importing a package for its fetch handler should
 * not require `nodejs_compat`.
 *
 * A plain `await import('node:http')` does not help — a static string literal
 * is just as analyzable, and the same bundler reports the same error. Only a
 * specifier the bundler cannot read survives, which is why `name` is joined
 * here rather than written inline. On Node the import resolves normally at
 * call time; on Workers it is never called, because nothing calls the Node
 * adapters there.
 *
 * @example
 * ```typescript
 * const { validateHeaderName } = await importNodeModule<typeof import('node:http')>('http')
 * ```
 */
const loaded = new Map<string, Promise<unknown>>()

export const importNodeModule = <T>(name: string): Promise<T> => {
  let pending = loaded.get(name)
  if (pending === undefined) {
    // The concatenation is the whole point: written as a literal, every
    // bundler would resolve it eagerly and the build would fail.
    pending = import(/* @vite-ignore */ /* webpackIgnore: true */ 'node:' + name)
    loaded.set(name, pending)
  }
  return pending as Promise<T>
}
