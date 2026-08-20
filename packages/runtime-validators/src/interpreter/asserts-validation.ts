import { own } from '@/interpreter/own'
import { resolveUri, type SchemaRegistry, withoutFragment } from '@/interpreter/schema-registry'

/**
 * The 2020-12 validation vocabulary — `type`, `enum`, `const`, `required`, the
 * numeric bounds, the length bounds, and so on. A dialect that leaves it out
 * keeps those keywords as *annotations*: they are still legal to write, they
 * simply never make an instance invalid.
 */
const VALIDATION_VOCABULARY = 'https://json-schema.org/draft/2020-12/vocab/validation'

/**
 * Whether the validation vocabulary is in force for `schema`.
 *
 * A schema names its dialect with `$schema`, and the metaschema at that URI
 * lists the dialect's vocabularies in `$vocabulary`. A metaschema that omits the
 * validation vocabulary — the suite's `metaschema-no-validation.json` is the
 * canonical example — declares a dialect where `minimum` and friends assert
 * nothing, so a validator that kept enforcing them would be answering a question
 * the schema author did not ask.
 *
 * Reading that metaschema used to mean fetching it, which this package does not
 * do. It does not have to any more: if the caller registered the metaschema
 * through `ValidateOptions.schemas`, it is right there in the registry. When it
 * is not — the usual case, including every schema pointing at the standard
 * 2020-12 metaschema — we say `true` and enforce everything, which is the
 * stricter and safer of the two answers.
 *
 * The answer is computed once per validator from the *root* schema's `$schema`,
 * not per schema resource. A document that mixes dialects between its embedded
 * resources (legal, and vanishingly rare) is therefore judged by its root's.
 */
export const assertsValidation = (schema: unknown, registry: SchemaRegistry | null): boolean => {
  if (registry === null || schema === null || typeof schema !== 'object' || Array.isArray(schema)) return true

  const dialect = own(schema as Record<string, unknown>, '$schema')
  if (typeof dialect !== 'string') return true

  const uri = withoutFragment(resolveUri(dialect, registry.rootBase) ?? dialect)
  const metaschema = registry.resources.get(uri)
  if (metaschema === null || typeof metaschema !== 'object' || Array.isArray(metaschema)) return true

  const vocabulary = own(metaschema as Record<string, unknown>, '$vocabulary')
  if (vocabulary === null || typeof vocabulary !== 'object' || Array.isArray(vocabulary)) return true

  // `$vocabulary` *enumerates* the dialect. Presence is what counts, not the
  // boolean value — `true` means "you must understand this one", `false` means
  // "you may ignore it", and both mean the vocabulary is part of the dialect.
  return Object.hasOwn(vocabulary, VALIDATION_VOCABULARY)
}
