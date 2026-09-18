import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { readKey } from './read-key'
import { resolveRef } from './resolve-ref'
import { isSchemaObject } from './schema-guards'

/**
 * The conditional definition an `allOf` member's local `$ref` points at, when it
 * points at one.
 *
 * OpenAPI's security scheme composes its per-type rules as `allOf: [{ $ref:
 * '#/$defs/type-http' }, …]`, each definition an `if`/`then` on the `type` the
 * composing schema enumerates. The definition's own file cannot see that
 * enumeration, so its conditional drops there; the type emitter reads the
 * definition *here* instead and renders its arms into the composing type.
 *
 * That makes this the one place where a type name reaches a file through a
 * `$ref` the file never walks into, which is why the import collectors ask the
 * same question rather than each deciding for themselves: `security-scheme.ts`
 * named `OauthFlows` in an arm it had inlined while `security-scheme-type-oauth2.ts`
 * imported it and rendered nothing — a `TS2304` in one file and a `TS6133` in
 * the other, from a single disagreement about what gets inlined.
 */
export const referencedConditional = (
  entry: JSONSchema,
  rootSchema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!isSchemaObject(entry) || rootSchema === undefined) return undefined
  const ref = readKey(entry as Record<string, unknown>, '$ref')
  // Local refs only: the emitter resolves against the root document, and a URI
  // ref may name a resource this build never loaded.
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined
  const resolved = resolveRef(ref, rootSchema) as JSONSchema | undefined
  if (resolved === undefined || !isSchemaObject(resolved)) return undefined
  return Object.hasOwn(resolved as Record<string, unknown>, 'if') ? (resolved as Record<string, unknown>) : undefined
}
