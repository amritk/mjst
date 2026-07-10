import { validate } from '@amritk/runtime-validators'

import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

// The two example rules below are kept in one module because they share private
// DAG-memoization state and validator-building helpers.

type RuntimeValidator = (input: unknown) => true | { valid: false; errors: { message: string; path: string }[] }

// The example schemas come from the *linted document*, so they are only known at
// runtime. `@amritk/runtime-validators` interprets a schema directly — no
// `ajv.compile` (whose codegen dominated lint time on large specs, recompiling
// `$ref`-duplicated schemas tens of thousands of times) and no `new Function`,
// so it is also CSP/edge-runtime safe. Returns undefined for a non-object or a
// schema the validator can't build (mirrors the old skip-on-compile-failure
// behavior).
const buildValidator = (schema: unknown): RuntimeValidator | undefined => {
  if (!isObject(schema)) return undefined
  try {
    return validate(schema) as RuntimeValidator
  } catch {
    return undefined
  }
}

const buildValidatorOrNull = (schema: unknown): RuntimeValidator | null => buildValidator(schema) ?? null

// DAG memoization for example validation.
//
// `@amritk/resolve-refs` shares object identity for repeated `$ref` targets, so a
// component schema (or media type) `$ref`'d from N call sites is a *single* object
// in the dereferenced tree, not N copies. The two example rules below `$..`-match
// every such occurrence — on digitalocean.yaml that is ~22.5k schema occurrences
// over only ~2.5k distinct schema objects — and each occurrence used to *build and
// run* a runtime-validator from scratch (the dominant remaining rule-run cost: the
// per-occurrence build+run of these rules is ~65 ms, of which the validator *run*
// is ~50 ms; building alone is cheap).
//
// Because a function's findings are determined entirely by the node it is reached
// on, we memoize each rule's result by that node's identity, keyed so the cache
// holds only the path-independent part (the messages and a relative path suffix)
// and the absolute path is reattached per occurrence. Repeated `$ref` targets hit
// the cache and skip the build+run+format work; inline (un-shared) nodes miss and
// compute once, exactly as before. The findings are byte-identical. An empty array
// records "no finding here" so misses are not recomputed per occurrence.

/** A finding minus its absolute location: the message plus the path suffix appended to `context.path`. */
type RelativeFinding = {
  message: string
  suffix: JsonPath
}

// Keyed by the Schema Object node; `oasSchemaExample` validates a schema's own
// `example` against the schema minus its `example`/`examples` keywords.
const schemaExampleResults = new WeakMap<object, RelativeFinding[]>()
// Keyed by the Media Type Object node; `oasMediaExample` validates the media's
// `example`/`examples` against the media's `schema`. The node (not the schema) is
// the cache key because two media objects can share a `schema` but carry different
// examples.
const mediaExampleResults = new WeakMap<object, RelativeFinding[]>()

const withPath = (findings: RelativeFinding[], path: JsonPath): IFunctionResult[] => {
  if (findings.length === 0) return []
  return findings.map((finding) => ({ message: finding.message, path: [...path, ...finding.suffix] }))
}

/** Validates a schema object's inline `example` against the schema itself. */
export const oasSchemaExample: RulesetFunction = (schema, _options, context) => {
  if (!isObject(schema) || schema['example'] === undefined) return []
  let findings = schemaExampleResults.get(schema)
  if (findings === undefined) {
    findings = []
    const { example, examples, ...rest } = schema
    void example
    void examples
    const check = buildValidatorOrNull(rest)
    if (check) {
      const result = check(schema['example'])
      if (result !== true) {
        for (const error of result.errors)
          findings.push({ message: `"example" ${error.message}`.trim(), suffix: ['example'] })
      }
    }
    schemaExampleResults.set(schema, findings)
  }
  return withPath(findings, context.path)
}

/** Validates media type / parameter `example` and `examples` against the schema. */
export const oasMediaExample: RulesetFunction = (media, _options, context) => {
  if (!isObject(media) || !isObject(media['schema'])) return []
  // Skip building a validator when there is no example to check (most media
  // objects in a large spec have a schema but no example).
  const hasExample = media['example'] !== undefined || isObject(media['examples'])
  if (!hasExample) return []
  let findings = mediaExampleResults.get(media)
  if (findings === undefined) {
    findings = []
    const check = buildValidatorOrNull(media['schema'])
    if (check) {
      if (media['example'] !== undefined) {
        const result = check(media['example'])
        if (result !== true) {
          for (const error of result.errors)
            findings.push({ message: `"example" ${error.message}`.trim(), suffix: ['example'] })
        }
      }
      const examples = isObject(media['examples']) ? media['examples'] : undefined
      if (examples) {
        for (const [name, example] of Object.entries(examples)) {
          if (isObject(example) && example['value'] !== undefined) {
            const result = check(example['value'])
            if (result !== true) {
              for (const error of result.errors) {
                findings.push({
                  message: `Example "${name}" ${error.message}`.trim(),
                  suffix: ['examples', name, 'value'],
                })
              }
            }
          }
        }
      }
    }
    mediaExampleResults.set(media, findings)
  }
  return withPath(findings, context.path)
}
