import type { JsonPath } from '../../core'
import type { EditOp, Fixer, FixerRegistry } from '../../fix'

/** Reads the value at `path` in the parsed document, or `undefined` if absent. */
const getAtPath = (data: unknown, path: JsonPath): unknown => {
  let current: unknown = data
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[segment as string]
  }
  return current
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

/**
 * `oas2-host-trailing-slash` / `oas3-server-trailing-slash`: drop the trailing
 * slash from a string value (host or server URL).
 */
const trailingSlashValue: Fixer = {
  safe: true,
  fix: ({ diagnostic, data }) => {
    const value = getAtPath(data, diagnostic.path)
    if (typeof value !== 'string') return undefined
    const stripped = stripTrailingSlash(value)
    if (stripped === value || stripped === '') return undefined
    return { op: 'setValue', path: diagnostic.path, value: stripped }
  },
}

/** `path-keys-no-trailing-slash`: rename a `paths` key to drop its trailing slash. */
const pathKeyTrailingSlash: Fixer = {
  safe: true,
  fix: ({ diagnostic }) => {
    const key = diagnostic.path[diagnostic.path.length - 1]
    if (typeof key !== 'string') return undefined
    const stripped = stripTrailingSlash(key)
    if (stripped === key || stripped === '') return undefined
    return { op: 'renameProperty', path: diagnostic.path, newKey: stripped }
  },
}

/** `no-$ref-siblings`: delete the sibling key that sits next to a `$ref`. */
const refSibling: Fixer = {
  safe: true,
  fix: ({ diagnostic }) => {
    if (diagnostic.path.length === 0) return undefined
    return { op: 'removeProperty', path: diagnostic.path }
  },
}

/** `duplicated-entry-in-enum`: remove the later copies of each repeated enum value. */
const duplicatedEnum: Fixer = {
  safe: true,
  fix: ({ diagnostic, data }) => {
    const array = getAtPath(data, diagnostic.path)
    if (!Array.isArray(array)) return undefined
    const seen = new Set<string>()
    const duplicates: number[] = []
    array.forEach((item, index) => {
      const key = JSON.stringify(item)
      if (seen.has(key)) duplicates.push(index)
      else seen.add(key)
    })
    if (duplicates.length === 0) return undefined
    return { op: 'removeItems', path: diagnostic.path, indices: duplicates }
  },
}

/** `openapi-tags-alphabetical`: reorder the top-level `tags` array by `name`. */
const tagsAlphabetical: Fixer = {
  safe: true,
  fix: ({ diagnostic, data }) => {
    // Findings point at the out-of-order item; the array is its parent.
    const arrayPath = diagnostic.path.slice(0, -1)
    const array = getAtPath(data, arrayPath)
    if (!Array.isArray(array)) return undefined
    const nameOf = (item: unknown): string =>
      item != null && typeof item === 'object' ? String((item as Record<string, unknown>)['name']) : String(item)
    const order = array.map((_, index) => index).sort((a, b) => nameOf(array[a]).localeCompare(nameOf(array[b])))
    if (order.every((value, index) => value === index)) return undefined
    return { op: 'reorderArray', path: arrayPath, order }
  },
}

/** `path-not-include-query`: drop the `?query` portion from a `paths` key. */
const pathKeyQueryString: Fixer = {
  safe: true,
  fix: ({ diagnostic, data }) => {
    const key = diagnostic.path[diagnostic.path.length - 1]
    if (typeof key !== 'string') return undefined
    const stripped = key.replace(/\?.*$/, '')
    if (stripped === key || stripped === '') return undefined
    // Renaming onto an existing path would collide and silently drop a path, so skip.
    const paths = getAtPath(data, diagnostic.path.slice(0, -1))
    if (isObject(paths) && stripped in paths) return undefined
    return { op: 'renameProperty', path: diagnostic.path, newKey: stripped }
  },
}

/** `openapi-tags-uniqueness`: remove the later copies of each repeated tag name. */
const tagsUnique: Fixer = {
  safe: true,
  fix: ({ diagnostic, data }) => {
    // Findings point at `tags[index].name`, so the array sits two segments up.
    const arrayPath = diagnostic.path.slice(0, -2)
    const array = getAtPath(data, arrayPath)
    if (!Array.isArray(array)) return undefined
    const seen = new Set<string>()
    const duplicates: number[] = []
    array.forEach((tag, index) => {
      const name = isObject(tag) ? tag['name'] : undefined
      if (typeof name !== 'string') return
      if (seen.has(name)) duplicates.push(index)
      else seen.add(name)
    })
    if (duplicates.length === 0) return undefined
    return { op: 'removeItems', path: arrayPath, indices: duplicates }
  },
}

/**
 * `oas3-unused-component` / `oas2-unused-definition`: delete the unreferenced
 * component. Marked unsafe because a component can be referenced from another
 * document or resolved dynamically, so removing it may not be semantics-preserving
 * — it only applies under `--fix-unsafe`.
 */
const unusedComponent: Fixer = {
  safe: false,
  fix: ({ diagnostic }) => {
    if (diagnostic.path.length === 0) return undefined
    return { op: 'removeProperty', path: diagnostic.path }
  },
}

/**
 * `oas3_1-no-nullable`: migrate the 3.0-era `nullable` keyword to its OpenAPI
 * 3.1 (JSON Schema 2020-12) equivalent. `nullable: false` is the schema default,
 * so it is simply dropped; `nullable: true` folds a `"null"` member into the
 * sibling `type` before the keyword is removed. Marked unsafe because it rewrites
 * the schema's `type`, so it only applies under `--fix-unsafe`.
 */
const noNullable: Fixer = {
  safe: false,
  fix: ({ diagnostic, data }) => {
    const value = getAtPath(data, diagnostic.path)
    const remove: EditOp = { op: 'removeProperty', path: diagnostic.path }
    // `nullable: false` (or any non-true value) is the default — drop the keyword.
    if (value !== true) return remove
    const typePath = [...diagnostic.path.slice(0, -1), 'type']
    const type = getAtPath(data, typePath)
    if (typeof type === 'string' && type !== 'null') {
      return [{ op: 'setValue', path: typePath, value: [type, 'null'] }, remove]
    }
    if (Array.isArray(type) && !type.includes('null')) {
      return [{ op: 'insertItem', path: typePath, value: 'null' }, remove]
    }
    // No type to widen (the schema already permits any value, null included) or
    // `null` is already allowed — removing the keyword is enough.
    return remove
  },
}

/**
 * Auto-fixers for the mechanically-repairable OpenAPI rules, keyed by rule
 * code. Pass these to `@amritk/lint`'s `fixDocument` (as its `fixers`), or wrap
 * them with `createFixPlugin` for a lower-level plugin.
 */
export const oasFixers: FixerRegistry = {
  'oas2-host-trailing-slash': trailingSlashValue,
  'oas3-server-trailing-slash': trailingSlashValue,
  'path-keys-no-trailing-slash': pathKeyTrailingSlash,
  'path-not-include-query': pathKeyQueryString,
  'no-$ref-siblings': refSibling,
  'duplicated-entry-in-enum': duplicatedEnum,
  'openapi-tags-alphabetical': tagsAlphabetical,
  'openapi-tags-uniqueness': tagsUnique,
  'oas3-unused-component': unusedComponent,
  'oas2-unused-definition': unusedComponent,
  'oas3_1-no-nullable': noNullable,
}
