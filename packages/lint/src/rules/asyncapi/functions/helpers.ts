import type { JsonPath } from '../../../core/types'
import { isObject } from '../../shared/helpers'

export { isObject } from '../../shared/helpers'

/** The two operation fields an AsyncAPI 2.x Channel Item Object may carry. */
export const V2_OPERATIONS = ['subscribe', 'publish'] as const

/** One AsyncAPI 2.x operation, with the path it sits at. */
export type LocatedOperation = {
  path: JsonPath
  kind: (typeof V2_OPERATIONS)[number]
  operation: Record<string, unknown>
}

/** One AsyncAPI 2.x message, with the path it sits at. */
export type LocatedMessage = { path: JsonPath; message: Record<string, unknown> }

/**
 * Every `{variable}` name in a channel address or server URL, in order. A name
 * is anything between braces, so `{}` yields nothing (the dedicated
 * `*-no-empty-parameter` rules report that) and a nested brace is left to the
 * structural schema.
 */
export const parseUrlVariables = (value: unknown): string[] =>
  typeof value !== 'string' ? [] : [...value.matchAll(/\{(.+?)\}/g)].map((match) => match[1] as string)

/** Walks the `publish`/`subscribe` operations of every 2.x channel. */
export function* getAllOperations(document: unknown): Generator<LocatedOperation> {
  const channels = isObject(document) ? document['channels'] : undefined
  if (!isObject(channels)) return
  for (const [address, channel] of Object.entries(channels)) {
    if (!isObject(channel)) continue
    for (const kind of V2_OPERATIONS) {
      const operation = channel[kind]
      if (isObject(operation)) yield { path: ['channels', address, kind], kind, operation }
    }
  }
}

/**
 * Walks every 2.x message: each operation's `message`, or — when that message is
 * a `oneOf` list — each alternative in it.
 */
export function* getAllMessages(document: unknown): Generator<LocatedMessage> {
  for (const { path, operation } of getAllOperations(document)) {
    const message = operation['message']
    if (!isObject(message)) continue
    const alternatives = message['oneOf']
    if (Array.isArray(alternatives)) {
      for (const [index, alternative] of alternatives.entries()) {
        if (isObject(alternative)) yield { path: [...path, 'message', 'oneOf', index], message: alternative }
      }
    } else {
      yield { path: [...path, 'message'], message }
    }
  }
}

// A message's `traits` are merged in with JSON Merge Patch, and the patch data
// comes from the linted document: a deeply nested trait would otherwise recurse
// as far as the document nests, and the parsers allow 1000 levels.
const MAX_MERGE_DEPTH = 64

/** The own value at `key`, or `undefined` — a bare index answers `__proto__` from the prototype chain. */
const ownValue = (source: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(source, key) ? source[key] : undefined

/** Assigns an own data property, `__proto__` included (a bare assignment would set the prototype). */
const assignOwn = (target: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    target[key] = value
  }
}

const mergePatch = (origin: unknown, patch: unknown, depth: number): unknown => {
  if (!isObject(patch) || depth >= MAX_MERGE_DEPTH) return patch
  const result: Record<string, unknown> = isObject(origin) ? { ...origin } : {}
  for (const key of Object.keys(patch)) {
    const patched = ownValue(patch, key)
    // JSON Merge Patch: a null in the patch removes the key rather than setting it.
    if (patched === null) delete result[key]
    else assignOwn(result, key, mergePatch(ownValue(result, key), patched, depth + 1))
  }
  return result
}

/**
 * Folds a Message (or Operation) Object's `traits` into the object itself, the
 * way a 2.x tool resolving the document would. The spec applies each trait as a
 * JSON Merge Patch in declaration order, so a trait overrides what the object
 * (and any earlier trait) declared. Returns the input unchanged when it declares
 * no `traits`.
 */
export const mergeTraits = (target: Record<string, unknown>): Record<string, unknown> => {
  const traits = target['traits']
  if (!Array.isArray(traits)) return target
  let merged: Record<string, unknown> = { ...target }
  for (const trait of traits) {
    if (isObject(trait)) merged = mergePatch(merged, trait, 0) as Record<string, unknown>
  }
  return merged
}
