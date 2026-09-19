import { describe, expect, it } from 'vitest'

import { resolveModes } from './resolve-modes'

describe('resolve-modes', () => {
  it('a bare run emits the type and a total parser', () => {
    expect(resolveModes({})).toEqual(['types', 'parse'])
  })

  it('--types-only stops at the type, with nothing that runs', () => {
    expect(resolveModes({ typesOnly: true })).toEqual(['types'])
    // Even asked for together with the flags that shape runtime code — the CLI
    // rejects those combinations, and this must not quietly emit one anyway.
    expect(resolveModes({ typesOnly: true, strict: true, validators: true })).toEqual(['types'])
  })

  it('--strict swaps the throwing parser in for the repairing one', () => {
    expect(resolveModes({ strict: true })).toEqual(['types', 'parseStrict'])
  })

  it('--validators adds the guard and the reporter, keeping the parser', () => {
    expect(resolveModes({ validators: true })).toEqual(['types', 'guard', 'validate', 'parse'])
  })

  it('each validator flag adds its own entry point', () => {
    expect(resolveModes({ validators: true, check: true })).toEqual(['types', 'guard', 'validate', 'check', 'parse'])
    expect(resolveModes({ validators: true, coerce: true })).toEqual(['types', 'guard', 'validate', 'coerce', 'parse'])
    expect(resolveModes({ validators: true, repair: true })).toEqual(['types', 'guard', 'validate', 'repair', 'parse'])
  })

  it('the validator flags mean nothing without --validators', () => {
    // The CLI exits before it gets here, so this is the belt to that braces: a
    // stray `coerce: true` in a config file must not smuggle a coercer in.
    expect(resolveModes({ check: true, coerce: true, repair: true })).toEqual(['types', 'parse'])
  })

  it('the whole matrix composes', () => {
    expect(resolveModes({ validators: true, check: true, coerce: true, repair: true, strict: true })).toEqual([
      'types',
      'guard',
      'validate',
      'check',
      'coerce',
      'repair',
      'parseStrict',
    ])
  })
})
