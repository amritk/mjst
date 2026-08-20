import { describe, expect, it } from 'vitest'

import { assertGeneratableRefs } from './assert-generatable-refs'
import { collectValidatorImports } from './collect-validator-imports'

describe('collect-validator-imports', () => {
  it('collects a direct property $ref', () => {
    const schema = { properties: { contact: { $ref: '#/$defs/contact' } } }

    expect(collectValidatorImports(schema)).toEqual(["import { type Contact, validateContact } from './contact.js'"])
  })

  it('collects $refs inside inline nested objects', () => {
    // The validator generator recurses into inline nested objects, so a $ref
    // buried inside one has to become an import too or the generated file
    // would reference a validator it never imported.
    const schema = {
      properties: {
        profile: {
          type: 'object' as const,
          properties: {
            address: { $ref: '#/$defs/address' },
            contacts: { type: 'array' as const, items: { $ref: '#/$defs/contact' } },
          },
        },
      },
    }

    expect(collectValidatorImports(schema)).toEqual([
      "import { type Address, validateAddress } from './address.js'",
      "import { type Contact, validateContact } from './contact.js'",
    ])
  })

  it('collects a $ref inside dependentSchemas', () => {
    // The validator emits `dependentSchemas` subschema checks, so a $ref reached
    // only through one must still be imported.
    const schema = {
      type: 'object' as const,
      properties: { a: { type: 'string' as const } },
      dependentSchemas: { a: { $ref: '#/$defs/extra' } },
    }

    expect(collectValidatorImports(schema)).toEqual(["import { type Extra, validateExtra } from './extra.js'"])
  })

  it('collects a $ref inside a draft-07 schema-form dependency', () => {
    // The emitter delegates schema-form `dependencies` via `validateX`, so a $ref
    // reached only through one must be imported (else the file calls an undefined
    // symbol). The array form carries only strings and contributes no import.
    const schema = {
      type: 'object' as const,
      properties: { a: { type: 'string' as const } },
      dependencies: { a: { $ref: '#/$defs/needB' }, b: ['a'] },
    }

    expect(collectValidatorImports(schema)).toEqual(["import { type NeedB, validateNeedB } from './need-b.js'"])
  })

  it('deduplicates a ref that appears both directly and inside a nested object', () => {
    const schema = {
      properties: {
        owner: { $ref: '#/$defs/contact' },
        profile: {
          type: 'object' as const,
          properties: { backup: { $ref: '#/$defs/contact' } },
        },
      },
    }

    expect(collectValidatorImports(schema)).toEqual(["import { type Contact, validateContact } from './contact.js'"])
  })

  it('collects refs the emitter delegates for via patternProperties, contains, prefixItems and if/then/else', () => {
    // Every one of these keywords makes the emitter emit a `validateX(...)` call,
    // so each referenced validator has to be imported or the output references an
    // undefined symbol. The old traversal covered none of these paths.
    const schema = {
      type: 'object' as const,
      patternProperties: { '^x-': { $ref: '#/$defs/ext' } },
      propertyNames: { $ref: '#/$defs/name' },
      if: { $ref: '#/$defs/cond' },
      then: { $ref: '#/$defs/ontrue' },
      else: { $ref: '#/$defs/onfalse' },
      properties: {
        list: {
          type: 'array' as const,
          contains: { $ref: '#/$defs/needle' },
          prefixItems: [{ $ref: '#/$defs/first' }],
        },
        branch: { oneOf: [{ $ref: '#/$defs/variant' }] },
      },
    }

    // Order follows traversal order (properties → patternProperties → single
    // subschema keywords). The point of the test is that NONE are dropped.
    expect(collectValidatorImports(schema)).toEqual([
      "import { type Needle, validateNeedle } from './needle.js'",
      "import { type First, validateFirst } from './first.js'",
      "import { type Variant, validateVariant } from './variant.js'",
      "import { type Ext, validateExt } from './ext.js'",
      "import { type Name, validateName } from './name.js'",
      "import { type Cond, validateCond } from './cond.js'",
      "import { type Ontrue, validateOntrue } from './ontrue.js'",
      "import { type Onfalse, validateOnfalse } from './onfalse.js'",
    ])
  })

  // Which `$ref`s the import list has to carry is decided by what the emitted
  // *file* references — and that is the type as well as the validator. The type
  // generator folds nothing: it unions every `anyOf` branch and reads a tuple's
  // rest from `additionalItems` whenever `items` is an array. Trimming the list to
  // what the validator still calls stranded those type names (`TS2304`), which is
  // worse than the unused import it saved.
  it('keeps a $ref the type references even when the validator folds its branch', () => {
    const rootSchema = { $defs: { a: { type: 'string' }, b: { type: 'number' } } }
    const names = (schema: unknown): string[] =>
      collectValidatorImports(schema as never, { rootSchema }).map((line) => /validate(\w+)/.exec(line)?.[1] ?? line)

    // The emitter drops a vacuous `anyOf`; the type still says `A | unknown`.
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, true] })).toEqual(['A'])
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, { description: 'anything' }] })).toEqual(['A'])
    // An `if` the emitter can decide picks its arm here too, and unlike `anyOf`
    // the type generator reads *neither* arm — it types the whole node `unknown`
    // — so the dropped arm is read by nobody. The set of spellings has to be the
    // emitter's: it folds on whether the `if`'s match came out constant, which
    // `{}` and an annotation-only schema do as surely as a literal `true`.
    // Deciding only the literals left an `if: {}` collecting an `else` nothing
    // emits. An `if` that depends on the value still keeps both arms.
    expect(names({ if: false, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual(['B'])
    expect(names({ if: true, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual(['A'])
    expect(names({ if: {}, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual(['A'])
    expect(names({ if: { description: 'x' }, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual(['A'])
    expect(names({ if: { type: 'string' }, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual([
      'A',
      'B',
    ])
    // `prefixItems` wins the positions, so the validator ignores the array
    // `items` and its `additionalItems` tail — but the type reads that tail.
    expect(
      names({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: [{ type: 'number' }],
        additionalItems: { $ref: '#/$defs/b' },
      }),
    ).toEqual(['B'])
    // An *empty* `prefixItems` still takes the positions, in the type generator as
    // in `tupleShapeOf` and the interpreter, so the array `items` behind it is
    // read by nobody and its ref is not collected. `getTuplePositions` used to
    // fall back to it at length 0 and name what was there, which made the type
    // claim a tuple neither validator enforced.
    expect(names({ type: 'array', prefixItems: [], items: [{ $ref: '#/$defs/a' }] })).toEqual([])
  })

  it('does not refuse an unresolvable $ref in an `if` arm the emitter never takes', () => {
    // `assertGeneratableRefs` reads the same set, so an over-collected arm is not
    // merely an unused import — it is a refusal to generate a schema that
    // generates fine. All three spellings the emitter folds have to agree.
    for (const branch of [{}, true, { description: 'x' }]) {
      expect(() =>
        assertGeneratableRefs({ if: branch, then: { type: 'string' }, else: { $ref: 'int.json' } } as never, 'Root'),
      ).not.toThrow()
    }
    // An `if` that is not a schema at all takes the keyword out entirely — the
    // emitter reads only a schema object or a boolean — so neither arm is
    // referenced and neither can refuse.
    for (const branch of [5, null, 'x']) {
      expect(() =>
        assertGeneratableRefs({ if: branch, then: { $ref: 'int.json' }, else: { $ref: 'int.json' } } as never, 'Root'),
      ).not.toThrow()
    }
    // The arm it *does* take still refuses, and so does an `if` it cannot decide.
    expect(() =>
      assertGeneratableRefs({ if: false, then: { type: 'string' }, else: { $ref: 'int.json' } } as never, 'Root'),
    ).toThrow(/unresolvable \$ref "int\.json"/)
    expect(() =>
      assertGeneratableRefs(
        { if: { type: 'string' }, then: { type: 'string' }, else: { $ref: 'int.json' } } as never,
        'Root',
      ),
    ).toThrow(/unresolvable \$ref "int\.json"/)
  })

  it('does not refuse an unresolvable $ref in a position only the type reads', () => {
    // `assertGeneratableRefs` reads the *emitted-call* set to ask whether the
    // output would call a validator that was never generated. A type-only
    // position never produces that call, and an unresolvable ref there types as
    // `unknown` and names nothing — so refusing over it turns down a schema that
    // generates fine. The call positions still refuse.
    expect(() =>
      assertGeneratableRefs(
        {
          type: 'array',
          prefixItems: [{ type: 'string' }],
          items: [{ type: 'number' }],
          additionalItems: { $ref: 'int.json' },
        } as never,
        'Root',
      ),
    ).not.toThrow()
    expect(() => assertGeneratableRefs({ type: 'array', items: { $ref: 'int.json' } } as never, 'Root')).toThrow(
      /unresolvable \$ref "int\.json"/,
    )
  })

  it('still skips a $ref in a position neither emitter reads', () => {
    const rootSchema = { $defs: { a: { type: 'string' }, b: { type: 'number' } } }
    const names = (schema: unknown): string[] =>
      collectValidatorImports(schema as never, { rootSchema }).map((line) => /validate(\w+)/.exec(line)?.[1] ?? line)

    // `then` means nothing without an `if`, and `additionalItems` means nothing
    // without an array `items` — neither the validator nor the type reads them, so
    // collecting them refused schemas whose ref happened to be unresolvable.
    expect(names({ $ref: '#/$defs/a', then: { $ref: '#/$defs/b' } })).toEqual(['A'])
    expect(names({ type: 'array', items: { type: 'number' }, additionalItems: { $ref: '#/$defs/b' } })).toEqual([])
    // `prefixItems` takes the tuple positions in `getTuplePositions` as well, so
    // the array `items` beside it is read by neither emitter.
    expect(names({ type: 'array', prefixItems: [{ type: 'string' }], items: [{ $ref: '#/$defs/a' }] })).toEqual([])
    // The tail next to that same shape *is* read, so the walk has to stay on.
    expect(
      names({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: [{ $ref: '#/$defs/a' }],
        additionalItems: { $ref: '#/$defs/b' },
      }),
    ).toEqual(['B'])
  })

  it('imports only the halves the caller says it reads', () => {
    // The two halves come apart in both directions: a `$ref` in a position the
    // type generator does not read is called and never named, one in a position
    // only the type reads is named and never called, and a ref inside a branch
    // that folded away is neither. Each half nothing reads is `TS6133` in the
    // generated file for a consumer with `noUnusedLocals`.
    const schema = { properties: { p: { $ref: '#/$defs/contact' } } } as never
    const halves = (type: boolean, validator: boolean): string[] =>
      collectValidatorImports(schema, { reads: () => ({ type, validator }) })

    expect(halves(true, true)).toEqual(["import { type Contact, validateContact } from './contact.js'"])
    expect(halves(false, true)).toEqual(["import { validateContact } from './contact.js'"])
    expect(halves(true, false)).toEqual(["import type { Contact } from './contact.js'"])
    expect(halves(false, false)).toEqual([])
  })

  it('imports a `-or-reference` def from its own file, under its own names', () => {
    // `walkRefGraph` writes a file per `$defs` entry, and both the emitter and the
    // type generator name this one in full — so rewriting the ref to `parameter`
    // here produced an import of the wrong module, under names the file never
    // used, while the body went on calling `validateParameterOrReference`. The
    // OpenAPI 3.1 metaschema names definitions exactly this way.
    const rootSchema = {
      $defs: {
        'parameter-or-reference': { anyOf: [{ $ref: '#/$defs/parameter' }, { $ref: '#/$defs/reference' }] },
        parameter: { type: 'object' },
        reference: { type: 'object' },
      },
    }

    expect(
      collectValidatorImports({ properties: { param: { $ref: '#/$defs/parameter-or-reference' } } } as never, {
        rootSchema,
      }),
    ).toEqual(["import { type ParameterOrReference, validateParameterOrReference } from './parameter-or-reference.js'"])
  })
})
