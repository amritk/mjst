import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { AdapterOptions } from './adapter'
import { reportLossyConstructs } from './report-lossy-constructs'

// Minimal structural view of `@valibot/to-json-schema`, so the adapter does not
// hard-depend on its types — the converter is loaded at runtime as an optional
// peer dependency. The converter hands each override hook an `errors` array: the
// conversion problems it found for that node. It is populated regardless of
// `errorMode`, so we can collect it ourselves and report widening on our terms.
type ValibotSchemaOverrideContext = {
  readonly valibotSchema?: { readonly type?: string }
  readonly errors?: readonly string[]
}

type ValibotActionOverrideContext = {
  readonly valibotAction?: { readonly type?: string }
  readonly errors?: readonly string[]
}

type ValibotConfig = {
  readonly errorMode?: 'throw' | 'warn' | 'ignore'
  readonly target?: 'draft-07' | 'draft-2020-12'
  readonly overrideSchema?: (ctx: ValibotSchemaOverrideContext) => Record<string, unknown> | undefined
  readonly overrideAction?: (ctx: ValibotActionOverrideContext) => Record<string, unknown> | undefined
}

type ToJsonSchema = (schema: unknown, config?: ValibotConfig) => Record<string, unknown>

/**
 * Resolves `@valibot/to-json-schema`'s `toJsonSchema` from a runtime import,
 * throwing a clear error when the converter is missing.
 */
const loadToJsonSchema = async (): Promise<ToJsonSchema> => {
  let mod: Record<string, unknown>
  try {
    mod = (await import('@valibot/to-json-schema')) as Record<string, unknown>
  } catch {
    throw new Error(
      "The Valibot adapter requires '@valibot/to-json-schema' (and 'valibot') to be installed in your project.",
    )
  }

  const named = mod['toJsonSchema']
  const fromDefault = (mod['default'] as Record<string, unknown> | undefined)?.['toJsonSchema']
  const converter = typeof named === 'function' ? named : typeof fromDefault === 'function' ? fromDefault : undefined

  if (!converter) {
    throw new Error("'@valibot/to-json-schema' did not export 'toJsonSchema'.")
  }

  return converter as ToJsonSchema
}

/**
 * Converts a Valibot schema into a Draft 2020-12 JSON Schema via
 * `@valibot/to-json-schema`.
 *
 * Valibot's `date` schema has no JSON Schema representation and would otherwise
 * throw, so we run the converter in `errorMode: 'ignore'` (unsupported constructs
 * degrade to an open schema instead of failing the whole conversion) and use the
 * `overrideSchema` hook to rewrite dates and bigints into the shared `x-mjst`
 * extension — the same handling TypeBox and Zod give them.
 *
 * `'ignore'` also silences the converter's own per-construct `console.warn`s.
 * That is deliberate: instead of letting a third-party library log widening in
 * its own words, we collect the constructs it could not represent (via the
 * `errors` array handed to each override hook) and report them ourselves through
 * {@link reportLossyConstructs} — one batched, mjst-branded warning, matching the
 * Zod adapter. In strict mode that same collection throws instead.
 */
export const valibotToJsonSchema = async (source: unknown, options?: AdapterOptions): Promise<JSONSchema> => {
  if (typeof source !== 'object' || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`Valibot adapter expected a Valibot schema but received ${received}.`)
  }

  const toJsonSchema = await loadToJsonSchema()

  // Every schema or action the converter could not fully represent, keyed by its
  // Valibot construct name (e.g. `symbol`, `blob`, `transform`) so the report
  // reads like the source rather than like internal error strings.
  const droppedConstructs = new Set<string>()

  let json: Record<string, unknown>
  try {
    json = toJsonSchema(source, {
      errorMode: 'ignore',
      // The converter defaults to draft-07, which emits fixed tuples as
      // `items: [...]`; the generators key tuple validation off 2020-12
      // `prefixItems`, so a draft-07 tuple would be silently under-validated
      // (element types and length unchecked). Target 2020-12 explicitly.
      target: 'draft-2020-12',
      overrideSchema: (ctx) => {
        // Rescued constructs are represented, not widened — return before we
        // record anything so `date`/`bigint` never show up as lossy.
        if (ctx.valibotSchema?.type === 'date') return { [MJST_EXTENSION_KEY]: { instanceOf: 'Date' } }
        if (ctx.valibotSchema?.type === 'bigint') return { [MJST_EXTENSION_KEY]: { primitive: 'bigint' } }
        if (ctx.errors && ctx.valibotSchema?.type) droppedConstructs.add(ctx.valibotSchema.type)
        return undefined
      },
      overrideAction: (ctx) => {
        // A dropped refinement (e.g. a regex flag JSON Schema cannot express)
        // also widens the result, so it belongs in the same report.
        if (ctx.errors && ctx.valibotAction?.type) droppedConstructs.add(ctx.valibotAction.type)
        return undefined
      },
    })
  } catch (error) {
    throw new Error(`Valibot adapter failed to convert the schema. Is it a valid Valibot schema?\n${String(error)}`)
  }

  // Surface everything that widened in one batched, branded notice (or throw in
  // strict mode).
  reportLossyConstructs('Valibot', droppedConstructs, options?.strict)

  // Drop the dialect marker the converter emits; the generators infer the
  // dialect from structure, not `$schema`.
  delete json['$schema']

  return json as JSONSchema
}
