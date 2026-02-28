/**
 * Normalizes an AsyncAPI JSON Schema so it is compatible with the build pipeline.
 *
 * The AsyncAPI spec-json-schemas package uses draft-07 conventions:
 * - `definitions` instead of `$defs`
 * - Full URI keys (e.g., "http://asyncapi.com/definitions/3.1.0/channel.json")
 * - Full URI `$ref` values
 *
 * Our build pipeline expects draft 2020-12 conventions:
 * - `$defs` with short kebab-case keys
 * - Internal `$ref` values like `#/$defs/channel`
 *
 * This function bridges that gap by rewriting definitions and all `$ref` values
 * throughout the schema tree.
 */

/**
 * Converts a camelCase or PascalCase string to kebab-case, stripping any
 * trailing "Object" suffix so the build pipeline does not double it.
 *
 * The pipeline appends "Object" to all type names, so "channelBindingsObject"
 * must become "channel-bindings" (not "channel-bindings-object") to avoid
 * generating "ChannelBindingsObjectObject".
 *
 * @example
 * camelToKebab("channelBindingsObject") // "channel-bindings"
 * camelToKebab("ReferenceObject") // "reference"
 * camelToKebab("schema") // "schema"
 */
const camelToKebab = (str: string): string => {
  // Strip trailing "Object" before converting, since the pipeline adds it back
  const stripped = str.endsWith('Object') && str !== 'Object' ? str.slice(0, -6) : str
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

/**
 * Derives a unique, kebab-case definition name from a full URI.
 *
 * Handles three URI patterns found in the AsyncAPI schema:
 * - `http://asyncapi.com/definitions/<version>/<name>.json`
 * - `http://asyncapi.com/bindings/<protocol>/<version>/<kind>.json`
 * - `http://asyncapi.com/extensions/<name>/<version>/<kind>.json`
 * - `http://json-schema.org/draft-07/schema` (special case)
 */
const uriToDefName = (uri: string): string => {
  const cleaned = uri.replace(/\.json$/, '').replace(/#$/, '')

  // Bindings: protocol-version-kind-binding
  const bindingMatch = cleaned.match(/\/bindings\/([^/]+)\/([^/]+)\/(.+)$/)
  if (bindingMatch) {
    // All capture groups are guaranteed to exist when the regex matches
    const [, protocol, version, kind] = bindingMatch as [string, string, string, string]
    const ver = version.replace(/\./g, '-')
    return `${protocol}-${ver}-${camelToKebab(kind)}-binding`
  }

  // Extensions: name-version-kind-extension
  const extensionMatch = cleaned.match(/\/extensions\/([^/]+)\/([^/]+)\/(.+)$/)
  if (extensionMatch) {
    // All capture groups are guaranteed to exist when the regex matches
    const [, name, version, kind] = extensionMatch as [string, string, string, string]
    const ver = version.replace(/\./g, '-')
    return `${name}-${ver}-${camelToKebab(kind)}-extension`
  }

  // Definitions with version 3.1.0 (primary spec version)
  const def310Match = cleaned.match(/\/definitions\/3\.1\.0\/(.+)$/)
  if (def310Match) {
    // def310Match[1] is guaranteed to exist when the regex matches
    return camelToKebab(def310Match[1] as string)
  }

  // Definitions with version 3.0.0 (legacy, prefixed to avoid collisions)
  const def300Match = cleaned.match(/\/definitions\/3\.0\.0\/(.+)$/)
  if (def300Match) {
    // def300Match[1] is guaranteed to exist when the regex matches
    return `v3-0-0-${camelToKebab(def300Match[1] as string)}`
  }

  // JSON Schema draft-07 meta-schema
  if (uri === 'http://json-schema.org/draft-07/schema') {
    return 'json-schema-draft-07'
  }

  // Fallback: use the last path segment
  const segments = cleaned.split('/')
  // Non-null assertion is safe: split always returns at least one element
  return camelToKebab(segments[segments.length - 1] as string)
}

/**
 * Recursively rewrites all `$ref` values in a schema tree from full URIs
 * to internal `#/$defs/<name>` references using the provided mapping.
 *
 * The `selfRef` parameter handles self-referencing schemas (like JSON Schema
 * draft-07) where `$ref: "#"` means "refer back to this definition itself."
 */
const rewriteRefs = (
  obj: unknown,
  uriToNameMap: ReadonlyMap<string, string>,
  selfRef?: string,
): unknown => {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => rewriteRefs(item, uriToNameMap, selfRef))
  }

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string') {
      // Strip trailing # from URI refs (e.g., "http://json-schema.org/draft-07/schema#")
      const normalizedRef = value.endsWith('#') && value !== '#' ? value.slice(0, -1) : value
      if (uriToNameMap.has(normalizedRef)) {
        result[key] = `#/$defs/${uriToNameMap.get(normalizedRef)}`
      } else if (value === '#' && selfRef) {
        // Self-reference: point back to this definition
        result[key] = selfRef
      } else if (value.startsWith('#/definitions/')) {
        // Rewrite local draft-07 #/definitions/X refs to #/$defs/X so the
        // pipeline can resolve them after we rename definitions to $defs
        result[key] = value.replace('#/definitions/', '#/$defs/')
      } else {
        result[key] = value
      }
    } else if (key === '$id') {
      // Strip $id fields since we are inlining everything under $defs
      continue
    } else if (key === 'definitions' && typeof value === 'object' && value !== null && selfRef) {
      // Convert draft-07 local "definitions" to "$defs" so the pipeline can
      // resolve internal refs like #/definitions/schemaArray as #/$defs/schemaArray
      result['$defs'] = rewriteRefs(value, uriToNameMap, selfRef)
    } else {
      result[key] = rewriteRefs(value, uriToNameMap, selfRef)
    }
  }

  return result
}

/**
 * Hoists nested `$defs` from embedded sub-schemas up to the root `$defs`.
 *
 * Some definitions (like json-schema-draft-07, avro, openapi-3.0) contain their
 * own local `$defs` (originally `definitions`). The build pipeline only resolves
 * refs against root-level `$defs`, so we hoist nested defs to the root with a
 * prefixed name and rewrite all `#/$defs/X` refs within those schemas to point
 * to the hoisted `#/$defs/parent-X` entries.
 */
const hoistNestedDefs = (defs: Record<string, unknown>): Record<string, unknown> => {
  const hoisted: Record<string, unknown> = {}

  for (const [parentName, parentSchema] of Object.entries(defs)) {
    if (typeof parentSchema !== 'object' || parentSchema === null) {
      hoisted[parentName] = parentSchema
      continue
    }

    const parentObj = parentSchema as Record<string, unknown>
    const nestedDefs = parentObj['$defs'] as Record<string, unknown> | undefined

    if (!nestedDefs || typeof nestedDefs !== 'object') {
      hoisted[parentName] = parentSchema
      continue
    }

    // Build a mapping from local ref to hoisted ref for this parent
    const localToHoisted = new Map<string, string>()
    for (const localName of Object.keys(nestedDefs)) {
      const hoistedName = `${parentName}-${camelToKebab(localName)}`
      localToHoisted.set(`#/$defs/${localName}`, `#/$defs/${hoistedName}`)
    }

    // Rewrite refs in the parent schema to point to hoisted defs
    const rewrittenParent = rewriteLocalRefs(parentObj, localToHoisted) as Record<string, unknown>

    // Remove the nested $defs from the parent since they are now at the root
    const { $defs: _, ...parentWithoutDefs } = rewrittenParent
    hoisted[parentName] = parentWithoutDefs

    // Hoist each nested def to the root, rewriting their internal refs too
    for (const [localName, localSchema] of Object.entries(nestedDefs)) {
      const hoistedName = `${parentName}-${camelToKebab(localName)}`
      hoisted[hoistedName] = rewriteLocalRefs(localSchema, localToHoisted)
    }
  }

  return hoisted
}

/**
 * Rewrites `$ref` values in a schema tree using a local ref mapping.
 * Used to rewrite `#/$defs/X` refs to their hoisted equivalents like `#/$defs/parent-X`.
 */
const rewriteLocalRefs = (
  obj: unknown,
  refMap: ReadonlyMap<string, string>,
): unknown => {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => rewriteLocalRefs(item, refMap))
  }

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string' && refMap.has(value)) {
      result[key] = refMap.get(value)
    } else {
      result[key] = rewriteLocalRefs(value, refMap)
    }
  }

  return result
}

/**
 * Normalizes an AsyncAPI JSON Schema from draft-07 URI-based definitions
 * into a draft 2020-12 compatible schema with `$defs` and internal `$ref` paths.
 *
 * @param schema - The raw AsyncAPI JSON Schema with URI-keyed definitions
 * @returns A normalized schema compatible with the buildSchema pipeline
 */
export const normalizeAsyncApiSchema = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const definitions = (schema['definitions'] ?? {}) as Record<string, unknown>

  // Build a mapping from full URI to short kebab-case name
  const uriToNameMap = new Map<string, string>()
  for (const uri of Object.keys(definitions)) {
    uriToNameMap.set(uri, uriToDefName(uri))
  }

  // Rebuild definitions under $defs with short keys
  const newDefs: Record<string, unknown> = {}
  for (const [uri, defSchema] of Object.entries(definitions)) {
    const name = uriToNameMap.get(uri)
    if (name) {
      // Pass the self-ref path so $ref: "#" within this definition resolves correctly
      newDefs[name] = rewriteRefs(defSchema, uriToNameMap, `#/$defs/${name}`)
    }
  }

  // Hoist nested $defs (from draft-07, avro, etc.) up to the root level
  // so the build pipeline can resolve all refs from a flat $defs map
  const hoistedDefs = hoistNestedDefs(newDefs)

  // Rewrite the root schema (excluding old definitions)
  const { definitions: _, $schema: __, ...rootRest } = schema
  const rewrittenRoot = rewriteRefs(rootRest, uriToNameMap) as Record<string, unknown>

  return {
    ...rewrittenRoot,
    $defs: hoistedDefs,
  }
}
