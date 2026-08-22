import { describe, expect, it } from 'vitest'
import { couldBeObject, type ShapeContext } from '#helpers/schema-shape'

/** Resolves `#/$defs/<name>` against a document, the way the inliner does. */
const contextFor = (defs: Record<string, unknown>): ShapeContext => ({
  resolve: (ref) => defs[ref.replace('#/$defs/', '')],
})

describe('schema-shape', () => {
  it('reads what a node says about itself', () => {
    expect(couldBeObject({ type: 'object' })).toBe(true)
    expect(couldBeObject({ type: 'string' })).toBe(false)
    expect(couldBeObject({})).toBe(true)
  })

  // Without a resolver every reference reads as "no type declared", which is
  // the same answer as "could be anything".
  it('follows a reference only when it is given one', () => {
    const defs = { Scalar: { type: 'string' } }
    expect(couldBeObject({ $ref: '#/$defs/Scalar' })).toBe(true)
    expect(couldBeObject({ $ref: '#/$defs/Scalar' }, contextFor(defs))).toBe(false)
  })

  // The idiom OpenAPI 3.0 uses to attach prose to a reference.
  it('follows a reference wrapped in an allOf', () => {
    const defs = {
      Scalar: { type: 'string' },
      Described: { description: 'A id.', allOf: [{ $ref: '#/$defs/Scalar' }] },
    }
    expect(couldBeObject({ $ref: '#/$defs/Described' }, contextFor(defs))).toBe(false)
  })

  // The ref site's keywords apply alongside the definition's, so a site that
  // declares its own shape is describing that shape.
  it('lets the ref site keywords beat the definition', () => {
    const defs = { Scalar: { type: 'string' } }
    expect(couldBeObject({ $ref: '#/$defs/Scalar', type: 'object' }, contextFor(defs))).toBe(true)
  })

  /**
   * A definition that is an object only if it is an object is taken to be one:
   * keeping a branch in a requirement intersection loses a marker, dropping one
   * invents a marker, and the first is the safer way to be wrong.
   *
   * The answer must not depend on the order the questions are asked, which is
   * what a shared memo of in-progress answers made it do.
   */
  it('answers a cycle the same way whichever end it is asked from', () => {
    const defs = {
      X: { allOf: [{ $ref: '#/$defs/Y' }, { type: 'string' }] },
      Y: { allOf: [{ $ref: '#/$defs/X' }] },
    }
    const first = contextFor(defs)
    expect(couldBeObject(defs.Y, first)).toBe(false)
    expect(couldBeObject({ $ref: '#/$defs/Y' }, first)).toBe(false)
    const second = contextFor(defs)
    expect(couldBeObject({ $ref: '#/$defs/Y' }, second)).toBe(false)
    expect(couldBeObject(defs.Y, second)).toBe(false)
  })

  // The safer way to be wrong, on a definition that composes itself: `Rec` is
  // an object, and reading the cycle as "not an object" would drop it from
  // every intersection it appears in and mark fields nothing requires.
  it('lets a definition that composes itself still be an object', () => {
    const defs = { Rec: { type: 'object', allOf: [{ $ref: '#/$defs/Rec' }] } }
    expect(couldBeObject(defs.Rec, contextFor(defs))).toBe(true)
  })
})
