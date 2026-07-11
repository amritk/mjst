import { validate } from '@amritk/runtime-validators'

import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

// The two example rules below are kept in one module because they share private
// DAG-memoization state and validator-building helpers.

type RuntimeValidator = (input: unknown) => true | { valid: false; errors: { message: string; path: string }[] }

/** Options selecting the OpenAPI major version an example rule runs against. */
export type IOasExampleOptions = {
  /** 2 for OpenAPI 2.0 (Swagger), 3 for OpenAPI 3.x. Defaults to 3. */
  oasVersion?: number
}

// The example schemas come from the *linted document*, so they are only known at
// runtime. `@amritk/runtime-validators` interprets a schema directly — no
// `ajv.compile` (whose codegen dominated lint time on large specs, recompiling
// `$ref`-duplicated schemas tens of thousands of times) and no `new Function`,
// so it is also CSP/edge-runtime safe. Returns undefined for a non-object or a
// schema the validator can't build (mirrors the old skip-on-compile-failure
// behavior).
//
// Formats are asserted (`formats: 'all'`) to match Spectral, whose example rules
// run ajv with `ajv-formats` enabled — otherwise a format-violating example (a
// bad `email`/`date`/`uuid`) would slip through. This mirrors the core `schema`
// built-in's option exactly; `@amritk/runtime-validators` treats the OAS-specific
// numeric/binary formats (`int32`/`int64`/`float`/`byte`/`binary`) as non-failing.
const buildValidator = (schema: unknown): RuntimeValidator | undefined => {
  if (!isObject(schema)) return undefined
  let validator: RuntimeValidator
  try {
    validator = validate(schema, { formats: 'all' }) as RuntimeValidator
  } catch {
    return undefined
  }
  // A schema can carry a `$ref` the runtime validator cannot resolve (an external
  // or cyclic ref left behind after `$ref` inlining), which throws at *run* time
  // rather than build time. Treat that as "cannot validate — skip" (returning a
  // valid result) so an unresolvable example schema never crashes the whole lint.
  return (input: unknown) => {
    try {
      return validator(input)
    } catch {
      return true
    }
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
// `example`/`default` against the schema minus its `example`/`examples` keywords.
const schemaExampleResults = new WeakMap<object, RelativeFinding[]>()
// Keyed by the Media Type / Response Object node; `oasMediaExample` validates the
// object's example(s) against its `schema`. The node (not the schema) is the cache
// key because two media objects can share a `schema` but carry different examples.
const mediaExampleResults = new WeakMap<object, RelativeFinding[]>()

const withPath = (findings: RelativeFinding[], path: JsonPath): IFunctionResult[] => {
  if (findings.length === 0) return []
  return findings.map((finding) => ({ message: finding.message, path: [...path, ...finding.suffix] }))
}

// A schema node reached via `$..[?(...)]` might be a `properties`/`patternProperties`
// *map* whose keys happen to look like schema keywords (e.g. a property literally
// named `type`). Those maps are not Schema Objects, so we never validate them.
const isPropertiesMap = (path: JsonPath): boolean => {
  const tail = path[path.length - 1]
  return tail === 'properties' || tail === 'patternProperties'
}

/** Validates a schema object's inline `example` and `default` against the schema itself. */
export const oasSchemaExample: RulesetFunction = (schema, _options, context) => {
  if (!isObject(schema)) return []
  if (schema['example'] === undefined && schema['default'] === undefined) return []
  if (isPropertiesMap(context.path)) return []
  let findings = schemaExampleResults.get(schema)
  if (findings === undefined) {
    findings = []
    // `example`/`examples` are annotations, not constraints, so drop them before
    // building the validator; `default` stays (it is not a validation keyword).
    const { example, examples, ...rest } = schema
    void example
    void examples
    const check = buildValidatorOrNull(rest)
    if (check) {
      for (const field of ['example', 'default'] as const) {
        if (schema[field] === undefined) continue
        const result = check(schema[field])
        if (result !== true) {
          for (const error of result.errors)
            findings.push({ message: `"${field}" ${error.message}`.trim(), suffix: [field] })
        }
      }
    }
    schemaExampleResults.set(schema, findings)
  }
  return withPath(findings, context.path)
}

/**
 * Validates a Media Type / Response / Parameter object's examples against its
 * `schema`. Version-split because OpenAPI 2.0 and 3.x model examples differently:
 * - OAS3: a singular `example` value plus an `examples` map of Example Objects,
 *   each of which carries the value under `value`.
 * - OAS2: `examples` is a MIME-type → value map (`{ 'application/json': value }`),
 *   with no Example Objects and no singular `example` on the media object — so the
 *   3.x logic validated nothing at all for a real 2.0 document.
 */
export const oasMediaExample: RulesetFunction<unknown, IOasExampleOptions> = (media, options, context) => {
  if (!isObject(media) || !isObject(media['schema'])) return []
  const oasVersion = options?.oasVersion ?? 3
  // Skip building a validator when there is nothing to check — most media objects
  // in a large spec have a schema but no example. (OAS2 only has the map form.)
  const hasExample = (oasVersion !== 2 && media['example'] !== undefined) || isObject(media['examples'])
  if (!hasExample) return []

  let findings = mediaExampleResults.get(media)
  if (findings === undefined) {
    findings = []
    const check = buildValidatorOrNull(media['schema'])
    if (check) {
      if (oasVersion === 2) collectOas2(media, check, findings)
      else collectOas3(media, check, findings)
    }
    mediaExampleResults.set(media, findings)
  }
  return withPath(findings, context.path)
}

/** OAS2: validate each `examples[mimeType]` value against the sibling `schema`. */
const collectOas2 = (media: Record<string, unknown>, check: RuntimeValidator, findings: RelativeFinding[]): void => {
  const examples = isObject(media['examples']) ? media['examples'] : undefined
  if (!examples) return
  for (const [mimeType, value] of Object.entries(examples)) {
    const result = check(value)
    if (result !== true) {
      for (const error of result.errors) {
        findings.push({ message: `Example "${mimeType}" ${error.message}`.trim(), suffix: ['examples', mimeType] })
      }
    }
  }
}

/** OAS3: validate the singular `example` and each `examples[name].value` against the `schema`. */
const collectOas3 = (media: Record<string, unknown>, check: RuntimeValidator, findings: RelativeFinding[]): void => {
  if (media['example'] !== undefined) {
    const result = check(media['example'])
    if (result !== true) {
      for (const error of result.errors)
        findings.push({ message: `"example" ${error.message}`.trim(), suffix: ['example'] })
    }
  }
  const examples = isObject(media['examples']) ? media['examples'] : undefined
  if (!examples) return
  for (const [name, example] of Object.entries(examples)) {
    // An external-value example is fetched elsewhere, so there is nothing inline to check.
    if (isObject(example) && example['value'] !== undefined) {
      const result = check(example['value'])
      if (result !== true) {
        for (const error of result.errors) {
          findings.push({ message: `Example "${name}" ${error.message}`.trim(), suffix: ['examples', name, 'value'] })
        }
      }
    }
  }
}
