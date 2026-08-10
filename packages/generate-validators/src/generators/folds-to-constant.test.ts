import { describe, expect, it } from 'vitest'

import { foldsToConstant } from './folds-to-constant'
import { generateValidatorFunction } from './generate-validator-function'

/**
 * `foldsToConstant` exists to let the import collector predict which `if` arm the
 * emitter will keep. A prediction is only worth having if it matches, so this
 * file asks the emitter directly rather than restating the keyword list.
 *
 * The asymmetry is the point. Answering `true` for a keyword the emitter acts on
 * drops a branch that really is emitted — an import that never arrives and an
 * undefined identifier at runtime. Answering `undefined` for one it folds costs
 * an unused import. Every case below therefore checks the *emitter*, and the
 * sweep at the end fails the moment the two drift apart.
 */

/** Which arms the emitter actually emits for this `if`, read off the output. */
const emittedArms = (condition: unknown): 'both' | 'then' | 'else' | 'neither' => {
  const code = generateValidatorFunction(
    {
      if: condition,
      then: { $ref: '#/$defs/a' },
      else: { $ref: '#/$defs/b' },
      $defs: { a: { type: 'string' }, b: { type: 'number' } },
    } as never,
    'Root',
  )
  const then = code.includes('validateA(')
  const otherwise = code.includes('validateB(')
  if (then && otherwise) return 'both'
  if (then) return 'then'
  return otherwise ? 'else' : 'neither'
}

/** What `foldsToConstant` implies the emitter will do. */
const predictedArms = (condition: unknown): 'both' | 'then' | 'else' => {
  const decided = foldsToConstant(condition)
  if (decided === true) return 'then'
  return decided === false ? 'else' : 'both'
}

const ANNOTATIONS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['$anchor', { $anchor: 'x' }],
  ['$comment', { $comment: 'x' }],
  ['$defs', { $defs: { z: { type: 'string' } } }],
  ['$dynamicAnchor', { $dynamicAnchor: 'x' }],
  ['$id', { $id: 'https://example.test/s' }],
  ['$schema', { $schema: 'https://json-schema.org/draft/2020-12/schema' }],
  ['$vocabulary', { $vocabulary: {} }],
  ['contentEncoding', { contentEncoding: 'base64' }],
  ['contentMediaType', { contentMediaType: 'text/plain' }],
  ['contentSchema', { contentSchema: { type: 'string' } }],
  ['default', { default: 1 }],
  ['definitions', { definitions: { z: { type: 'string' } } }],
  ['deprecated', { deprecated: true }],
  ['description', { description: 'x' }],
  ['discriminator', { discriminator: { propertyName: 'k' } }],
  ['example', { example: 1 }],
  ['examples', { examples: [1] }],
  ['externalDocs', { externalDocs: { url: 'https://example.test' } }],
  ['format', { format: 'email' }],
  ['nullable', { nullable: true }],
  ['readOnly', { readOnly: true }],
  ['title', { title: 'x' }],
  ['writeOnly', { writeOnly: true }],
  ['xml', { xml: { name: 'n' } }],
]

const CONSTRAINING: ReadonlyArray<readonly [string, unknown]> = [
  ['type', { type: 'string' }],
  ['const', { const: 'x' }],
  ['enum', { enum: ['x'] }],
  ['minLength', { minLength: 1 }],
  ['required', { required: ['q'] }],
  ['properties', { properties: { p: { type: 'string' } } }],
  ['$ref', { $ref: '#/$defs/a' }],
  ['not', { not: { type: 'string' } }],
  ['an annotation beside a constraint', { title: 'x', type: 'string' }],
]

describe('folds-to-constant', () => {
  it('answers the literal booleans', () => {
    expect(foldsToConstant(true)).toBe(true)
    expect(foldsToConstant(false)).toBe(false)
    // An empty schema constrains nothing, which is the same answer as `true`.
    expect(foldsToConstant({})).toBe(true)
  })

  it('declines a value that is not a schema at all', () => {
    // Not "matches everything" — no verdict. What the emitter does with `if: 5`
    // is its own business, and it skips the keyword rather than folding it.
    for (const value of [5, 0, null, 'x', '']) expect(foldsToConstant(value)).toBeUndefined()
  })

  it.each(ANNOTATIONS)('agrees with the emitter that %s folds', (_label, condition) => {
    // Both halves matter: the emitter has to fold it (otherwise predicting a fold
    // drops a live branch), and the predicate has to say so (otherwise the arm is
    // collected for nothing).
    expect(emittedArms(condition)).toBe('then')
    expect(foldsToConstant(condition)).toBe(true)
  })

  it.each(CONSTRAINING)('declines %s, which the emitter does not fold', (_label, condition) => {
    expect(emittedArms(condition)).toBe('both')
    expect(foldsToConstant(condition)).toBeUndefined()
  })

  it('never predicts a fold the emitter does not make', () => {
    // The sweep the two lists above cannot do on their own: every pair of
    // annotations together, which is what a real schema looks like. A prediction
    // of `then` must never appear where the emitter emitted `both`.
    const wrong: string[] = []
    for (const [oneLabel, one] of ANNOTATIONS) {
      for (const [twoLabel, two] of ANNOTATIONS) {
        const condition = { ...one, ...two }
        const predicted = predictedArms(condition)
        const emitted = emittedArms(condition)
        // `neither` is unreachable here — every case is a schema object — and an
        // over-cautious `both` is merely an unused import, so only a predicted
        // fold that the emitter did not make is a failure.
        if (predicted !== 'both' && predicted !== emitted) {
          wrong.push(`${oneLabel} + ${twoLabel}: predicted ${predicted}, emitter ${emitted}`)
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([])
  })
})
