import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { readKey } from './read-key'
import { isSchemaObject } from './schema-guards'

/**
 * Vendor extension keyword carrying mjst-specific runtime hints that plain JSON
 * Schema cannot express on its own. Adapters (TypeBox, Zod, ...) emit it when a
 * source construct has no native JSON Schema equivalent, and the generators read
 * it to produce the right TypeScript type and runtime checks.
 */
export const MJST_EXTENSION_KEY = 'x-mjst'

/**
 * The shape of the `x-mjst` extension object.
 *
 * - `instanceOf` names a JavaScript class the value must be an instance of at
 *   runtime (e.g. `'Date'`). It round-trips constructs like TypeBox's
 *   `Type.Date()` that JSON Schema's core vocabulary has no keyword for.
 * - `primitive` names a non-JSON primitive type (e.g. `'bigint'`) that has no
 *   JSON Schema representation. Unlike `instanceOf`, the value is checked with
 *   `typeof`, not `instanceof`.
 * - `brand` carries a nominal-typing brand name. It is purely type-level: the
 *   runtime value still validates as its underlying JSON Schema type, but the
 *   generated TypeScript type is intersected with a unique brand so values are
 *   not interchangeable with the unbranded base type.
 * - `discriminator` names the property that says *which message* a frame is.
 *   Unlike the three above it is not read off a schema: it belongs on an
 *   AsyncAPI channel, whose messages become one `@amritk/api` message contract
 *   and therefore need one tag property between them. A document that spells
 *   its tag `event` rather than `type` says so once, on the channel, instead of
 *   the generator's caller having to remember per run.
 */
export type MjstExtension = {
  readonly instanceOf?: string
  readonly primitive?: string
  readonly brand?: string
  readonly discriminator?: string
}

// The runtime classes we know how to generate type/runtime handling for. An
// identifier-shaped name is not enough: the name lands verbatim in the emitted
// TypeScript, so `instanceOf: 'NotAGlobalClass'` compiled to a `TS2304` plus a
// runtime `ReferenceError`, and `instanceOf: 'globalThis'` produced `g?:
// globalThis` — not a type — plus a `TypeError` from `x instanceof globalThis`.
// Allow-listing mirrors how `primitive` is handled (see SUPPORTED_PRIMITIVES):
// a hint we cannot generate for degrades to ordinary type handling. Add entries
// here as the generators grow support (and keep the adapters' maps in step).
const SUPPORTED_INSTANCE_CLASSES = new Set(['Date'])

// The non-JSON primitives we know how to generate type/runtime handling for.
// Anything outside this set is ignored so unknown hints degrade gracefully.
const SUPPORTED_PRIMITIVES = new Set(['bigint'])

// One warning per unsupported class name, not one per schema node: the readers
// run many times over a single document and a repeated line reads like a loop.
const warnedInstanceClasses = new Set<string>()

// Brand names are embedded inside a single-quoted string literal in generated
// output, so we only allow characters that cannot break out of the literal.
const SAFE_BRAND = /^[\w$ -]+$/

// A discriminator lands in generated output twice over — quoted in the emitted
// `discriminator: '...'` and read as a property name off every frame — so it is
// held to the shape a JSON property that names a message plausibly has. The
// point is the same as SAFE_BRAND's: nothing here can end the string literal.
const SAFE_DISCRIMINATOR = /^[A-Za-z_$][\w$-]*$/

// One warning per rejected discriminator, for the same reason the class names
// above get one: the readers run repeatedly over a single document.
const warnedDiscriminators = new Set<string>()

/**
 * Own-property reads throughout: a bare index walks the prototype chain, so an
 * `Object.prototype['x-mjst']` set by any dependency made *every* schema in the
 * document report the same hint — a whole API's worth of properties typed
 * `Date`, or intersected with a brand nobody declared. This is the same question
 * `schema-guards` asks of the keywords it guards.
 *
 * The node is `unknown` rather than a `JSONSchema` because `discriminator` is
 * read off an AsyncAPI channel, which is not a schema at all. The widened
 * parameter is cast straight back for the guard rather than the guard being
 * rewritten: this runs two or three times per schema node across every
 * generator, and an inlined replacement — `typeof node !== 'object' || node ===
 * null` — measured a stable 3% slower on Node despite doing strictly less work,
 * a code-layout artifact of `||` against `isSchemaObject`'s `&&` chain. Leaving
 * the call alone leaves the generators' emitted hot path exactly as it was.
 *
 * Note what the guard does *not* do: `isSchemaObject` answers true for an array,
 * so an array reaches the `readKey` below. That is the behaviour this has always
 * had, and it is harmless — an array only reports a hint if someone gave it an
 * own `x-mjst`, and no caller passes one.
 */
const readExtensionString = (node: unknown, field: keyof MjstExtension): string | undefined => {
  if (!isSchemaObject(node as JSONSchema)) return undefined

  const extension = readKey(node as Record<string, unknown>, MJST_EXTENSION_KEY)
  if (typeof extension !== 'object' || extension === null) return undefined

  const value = readKey(extension as Record<string, unknown>, field)
  return typeof value === 'string' ? value : undefined
}

/**
 * Reads the `instanceOf` class name from a schema's `x-mjst` extension, when it
 * names a class the generators actually support (see
 * {@link SUPPORTED_INSTANCE_CLASSES}). Anything else is warned about once and
 * ignored, so callers fall back to ordinary type handling rather than emitting
 * a reference to a class that does not exist.
 */
export const getMjstInstanceOf = (schema: JSONSchema): string | undefined => {
  const instanceOf = readExtensionString(schema, 'instanceOf')
  if (instanceOf === undefined) return undefined
  if (SUPPORTED_INSTANCE_CLASSES.has(instanceOf)) return instanceOf

  if (instanceOf !== '' && !warnedInstanceClasses.has(instanceOf)) {
    warnedInstanceClasses.add(instanceOf)
    console.warn(
      `Warning: ignoring unsupported x-mjst instanceOf "${instanceOf}". ` +
        `Supported classes: ${[...SUPPORTED_INSTANCE_CLASSES].join(', ')}.`,
    )
  }
  return undefined
}

/**
 * Reads the `primitive` type name from a schema's `x-mjst` extension, when it is
 * one we support (e.g. `'bigint'`). Returns undefined otherwise.
 */
export const getMjstPrimitive = (schema: JSONSchema): string | undefined => {
  const primitive = readExtensionString(schema, 'primitive')
  return primitive !== undefined && SUPPORTED_PRIMITIVES.has(primitive) ? primitive : undefined
}

/**
 * Reads the nominal `brand` name from a schema's `x-mjst` extension, when it is
 * present and safe to embed in generated output. Returns undefined otherwise.
 */
export const getMjstBrand = (schema: JSONSchema): string | undefined => {
  const brand = readExtensionString(schema, 'brand')
  return brand !== undefined && SAFE_BRAND.test(brand) ? brand : undefined
}

/**
 * Reads the message `discriminator` property name from a node's `x-mjst`
 * extension — an AsyncAPI channel, in practice, rather than a schema.
 *
 * A name we could not safely emit (see {@link SAFE_DISCRIMINATOR}) is warned
 * about once and ignored, so the caller falls back to its own default rather
 * than writing a broken literal into generated code.
 */
export const getMjstDiscriminator = (node: unknown): string | undefined => {
  const discriminator = readExtensionString(node, 'discriminator')
  if (discriminator === undefined) return undefined
  if (SAFE_DISCRIMINATOR.test(discriminator)) return discriminator

  if (!warnedDiscriminators.has(discriminator)) {
    warnedDiscriminators.add(discriminator)
    console.warn(
      `Warning: ignoring unsupported x-mjst discriminator "${discriminator}". ` +
        'Expected a property name starting with a letter, "_" or "$".',
    )
  }
  return undefined
}
