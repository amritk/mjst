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
 * A deterministic, order-independent serialization used as an equality key. Plain
 * `JSON.stringify` is sensitive to object key order (`{a,b}` vs `{b,a}`), so two
 * deeply-equal enum entries could be seen as different and left un-deduplicated —
 * disagreeing with the `duplicated-entry-in-enum` rule (which compares by value)
 * and preventing `--fix` from converging. Sorting keys recursively fixes that.
 */
const canonicalKey = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalKey).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalKey((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

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
  fix: ({ diagnostic, data }) => {
    const key = diagnostic.path[diagnostic.path.length - 1]
    if (typeof key !== 'string') return undefined
    const stripped = stripTrailingSlash(key)
    if (stripped === key || stripped === '') return undefined
    // Renaming `/foo/` onto an existing `/foo` would collide and silently drop a
    // path, so skip when the stripped key already exists (same guard as
    // `pathKeyQueryString`).
    const paths = getAtPath(data, diagnostic.path.slice(0, -1))
    if (isObject(paths) && stripped in paths) return undefined
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
      const key = canonicalKey(item)
      if (seen.has(key)) duplicates.push(index)
      else seen.add(key)
    })
    if (duplicates.length === 0) return undefined
    return { op: 'removeItems', path: diagnostic.path, indices: duplicates }
  },
}

// Mirror the `alphabetical` built-in's comparator exactly so that sorting here
// produces an order the rule considers sorted — otherwise `--fix` could reorder
// into a sequence the rule still flags and never converge.
const compareAlphabetical = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** `openapi-tags-alphabetical`: reorder the top-level `tags` array by `name`. */
const tagsAlphabetical: Fixer = {
  safe: true,
  fix: ({ diagnostic, data }) => {
    // Findings point at the out-of-order item; the array is its parent.
    const arrayPath = diagnostic.path.slice(0, -1)
    const array = getAtPath(data, arrayPath)
    if (!Array.isArray(array)) return undefined
    const nameOf = (item: unknown): unknown =>
      item != null && typeof item === 'object' ? (item as Record<string, unknown>)['name'] : item
    const order = array.map((_, index) => index).sort((a, b) => compareAlphabetical(nameOf(array[a]), nameOf(array[b])))
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
 * `oas3_1-schema-example-deprecated`: migrate a Schema Object's singular
 * `example` to the JSON Schema 2020-12 `examples` array (`example: X` →
 * `examples: [X]`). Safe and mechanical, but skipped when an `examples` array is
 * already present so an existing one is never clobbered. The finding points at
 * the `example` key, whose parent is the schema.
 */
const schemaExampleDeprecated: Fixer = {
  safe: true,
  fix: ({ diagnostic, data }) => {
    const schemaPath = diagnostic.path.slice(0, -1)
    const schema = getAtPath(data, schemaPath)
    if (!isObject(schema) || !('example' in schema)) return undefined
    // Do not overwrite an already-present `examples` array.
    if ('examples' in schema) return undefined
    return [
      // `insertProperty` (not `setValue`) because `examples` is a new key: an
      // op whose path doesn't already resolve is a no-op, and only
      // `insertProperty` adds a missing key to the existing schema object.
      { op: 'insertProperty', path: schemaPath, key: 'examples', value: [schema['example']] },
      { op: 'removeProperty', path: diagnostic.path },
    ]
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
  'oas3_1-schema-example-deprecated': schemaExampleDeprecated,
}
