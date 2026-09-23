import { foldNullable } from '@amritk/helpers/fold-nullable'
import { upgradeDraft07Schema } from '@amritk/helpers/upgrade-draft07-schema'

import type { SchemaFormatFamily } from './schema-format'

/** The dialects {@link normalizeSchema} reads; Avro and unknown formats never reach it. */
type NormalizableFamily = Exclude<SchemaFormatFamily, 'unsupported' | 'avro'>

/**
 * Normalized copies keyed by the raw schema object they came from, shared across
 * one extraction. Every message that references a component copies it in again,
 * so without this the draft-07 upgrade reruns once per message per component.
 * The copies are safe to share because nothing downstream writes into them: the
 * ref rewrite builds new objects. Keep one per extraction rather than per module,
 * so a document edited between two extractions is never answered from the first.
 */
export type NormalizeSchemaCache = WeakMap<Record<string, unknown>, Map<NormalizableFamily, Record<string, unknown>>>

/**
 * Normalizes one extracted schema into the 2020-12 conventions the generators
 * expect, according to the dialect its `schemaFormat` named:
 *
 * - `'asyncapi'` / `'draft-07'` — run the draft-07 upgrade (`definitions` →
 *   `$defs`, refs rewritten, nested defs hoisted). The upgrade only fires on a
 *   schema that *declares* draft-07, and an AsyncAPI payload almost never
 *   carries `$schema` at all, so the declaration is stamped on first: the
 *   dialect was declared at the message level, out of the schema's sight. The
 *   upgrade strips the stamp again on output.
 * - `'openapi'` — fold `nullable: true` into the `type` list, the one 3.0-ism
 *   the generators would otherwise read as "never null".
 * - `'2020-12'` — pass through.
 *
 * Avro never reaches here: it is a different schema language rather than a
 * dialect of this one, so `normalize-message` hands it to `@amritk/adapters`
 * and receives 2020-12 back already converted.
 *
 * Keywords the AsyncAPI dialect adds beyond draft-07 (and draft-07 spellings
 * the upgrade does not rewrite, like array-form `items`) pass through
 * unchanged: `@amritk/runtime-validators` implements them directly, and an
 * unknown keyword is an annotation everywhere else in the pipeline.
 *
 * An empty `$defs` left behind by the upgrade is dropped so a schema with no
 * definitions round-trips without growing keys.
 */
export const normalizeSchema = (
  schema: Record<string, unknown>,
  family: NormalizableFamily,
  cache?: NormalizeSchemaCache,
): Record<string, unknown> => {
  if (family === '2020-12') return schema
  if (cache === undefined) return normalizeUncached(schema, family)

  const byFamily = cache.get(schema) ?? new Map<NormalizableFamily, Record<string, unknown>>()
  const cached = byFamily.get(family)
  if (cached !== undefined) return cached
  const normalized = normalizeUncached(schema, family)
  byFamily.set(family, normalized)
  cache.set(schema, byFamily)
  return normalized
}

const normalizeUncached = (schema: Record<string, unknown>, family: NormalizableFamily): Record<string, unknown> => {
  if (family === 'openapi') return foldNullable(schema)

  const upgraded = upgradeDraft07Schema({ ...schema, $schema: 'http://json-schema.org/draft-07/schema' })
  const defs = upgraded['$defs']
  if (typeof defs === 'object' && defs !== null && Object.keys(defs).length === 0) {
    const { $defs: _, ...rest } = upgraded
    return rest
  }
  return upgraded
}
