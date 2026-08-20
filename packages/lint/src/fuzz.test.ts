import { describe, expect, it } from 'vitest'

import { lint } from './core'
import type { RulesetDefinition } from './core/types'
import { fixDocument, lintDocument } from './index'
import { createOpenApiRuleset, oas, oasFixers } from './rules/openapi/index'

// A document and a ruleset are both attacker-shaped inputs — one is the file
// being linted, the other is configuration someone else may have written — and
// the engine's contract is that neither can make it fail in an unexplained way.
// It may produce findings, and it may refuse a broken ruleset with a *named*
// error, but a TypeError from deep inside a walk is always a bug. This sweep
// crosses random rulesets with awkward documents to hold that line; it is seeded,
// so a failure reproduces exactly.
let seed = 20260820
const rand = (n: number): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed % n
}
const pick = <T>(values: T[]): T => values[rand(values.length)] as T

const GIVENS = [
  '$',
  '$..*',
  '$.a',
  '$..enum',
  '$..enum^',
  '$..[?(@ && @.type)]',
  '$.a[*]',
  '$..~',
  '$[?(@property === "constructor")]',
  '$..a[0:2]',
  '$..[(@.length-1)]',
  '$.paths[*][get,post]',
  '$..[?(@.x.y.z === 1)]',
  '$..["a","b"]',
  '$..[?(@ && @.a.match(/x/))]',
  '$..^',
  '$[*]~',
  '$..[?(!@)]',
  '$..[?(@ && @.a == "1")]',
  '$..[?(@path === "$[\'a\']")]',
  '$..[?(@parent && @parentProperty)]',
  '$..[-1:]',
  '$..[::2]',
  '$..[?(@root.a)]',
  '$[0,1]',
]
const FUNCTIONS = [
  'truthy',
  'falsy',
  'defined',
  'undefined',
  'casing',
  'pattern',
  'length',
  'alphabetical',
  'enumeration',
  'schema',
  'xor',
  'or',
  'typedEnum',
  'unreferencedReusableObject',
  // Not registered, and two names that only exist on `Object.prototype`.
  'nope',
  'toString',
  'constructor',
]
const FIELDS = [undefined, '@key', 'a', '0', 'constructor', '$..b', '__proto__', 'toString']
const OPTIONS: unknown[] = [
  undefined,
  {},
  { type: 'camel' },
  { type: 'nope' },
  { match: '(' },
  { match: '/a/gi' },
  { min: 1, max: 2 },
  { keyedBy: 'name' },
  { values: [1, 'a'] },
  { schema: { type: 'nope' } },
  { schema: { type: 'object', required: ['a'] } },
  { properties: ['a', 'constructor'] },
  { reusableObjectsLocation: '#/definitions' },
  { separator: { char: 5 } },
]
const SEVERITIES = [undefined, 'error', 'warn', 'off', 'constructor', 'toString', 99, -1]

const DOCUMENTS = [
  'a: 1\n',
  '{"a":1}',
  '',
  'a: &x\n  b: 1\nc: *x\n',
  'a: [1,2,3]\nb: {c: {d: {e: 1}}}\n',
  'constructor: 1\ntoString: 2\n__proto__: 3\n',
  'a: 1\n---\nb: 2\n',
  'openapi: "3.0.0"\ninfo: {title: t, version: "1"}\npaths: {/a/{constructor}: {get: {responses: {"200": {description: ok}}}}}\n',
  'swagger: "2.0"\ninfo: {title: t, version: "1"}\npaths: {}\ndefinitions: {A: {type: object, discriminator: valueOf, enum: [1]}}\n',
  '- 1\n- 2\n',
  'null\n',
  '"just a string"\n',
  '[1, {"a": [null, true]}]',
  'a:\n  - {b: [ {c: 1} ]}\n',
  'a: .inf\nb: .nan\n',
  '? [complex, key]\n: value\n',
  'base: &b {x: 1}\nderived:\n  <<: *b\n  y: 2\n',
  '{"a": [[[[[[[[[[1]]]]]]]]]]}',
  '- - - 1\n',
  'unterminated: [1, 2\n',
]

// The errors a deliberately-broken ruleset is *supposed* to raise. Anything else
// escaping the pipeline is the bug this sweep is looking for.
const DOCUMENTED_RULESET_ERRORS =
  /invalid `given`|missing `given`|must be a rule definition|undefined alias|Cannot extend non-existing rule/

const randomRule = (): unknown => ({
  given: rand(4) === 0 ? [pick(GIVENS), pick(GIVENS)] : pick(GIVENS),
  severity: pick(SEVERITIES),
  ...(rand(3) === 0 ? { message: '{{property}}|{{toString}}|{{value}}|{{nope}}' } : {}),
  ...(rand(4) === 0 ? { resolved: false } : {}),
  ...(rand(4) === 0 ? { formats: ['oas2'] } : {}),
  then: {
    ...(rand(2) === 0 ? { field: pick(FIELDS) } : {}),
    function: pick(FUNCTIONS),
    functionOptions: pick(OPTIONS),
  },
})

const randomRuleset = (): RulesetDefinition =>
  ({
    rules: Object.fromEntries(
      Array.from({ length: 1 + rand(4) }, (_, index) => [
        pick([`r${index}`, 'constructor', 'toString', '__proto__']),
        randomRule(),
      ]),
    ),
    ...(rand(3) === 0
      ? {
          overrides: [
            { files: [pick(['**', '*.yaml', 'x.yaml#/a', '{a,b}/**', '**#'])], rules: { r0: pick(SEVERITIES) } },
          ],
        }
      : {}),
    ...(rand(4) === 0 ? { aliases: { Nope: ['$.a'] } } : {}),
  }) as RulesetDefinition

describe('lint pipeline robustness (random rulesets)', () => {
  it('never fails in a way it cannot explain, and always returns well-formed findings', async () => {
    const failures: string[] = []
    for (let i = 0; i < 2000; i++) {
      const ruleset = randomRuleset()
      const document = pick(DOCUMENTS)
      try {
        for (const finding of await lintDocument(document, { ruleset, source: 'x.yaml' })) {
          // A severity that is not a number is the failure mode that makes a CLI
          // exit 0 on an error, so it is asserted rather than assumed.
          if (typeof finding.severity !== 'number') failures.push(`severity is ${typeof finding.severity}`)
          if (typeof finding.message !== 'string') failures.push(`message is ${typeof finding.message}`)
          if (!Array.isArray(finding.path)) failures.push('path is not an array')
          if (typeof finding.range?.start?.line !== 'number') failures.push('range is malformed')
        }
      } catch (error) {
        const message = (error as Error).message
        if (DOCUMENTED_RULESET_ERRORS.test(message)) continue
        failures.push(`threw: ${message} | ruleset=${JSON.stringify(ruleset).slice(0, 200)}`)
      }
    }
    expect(failures.slice(0, 5)).toEqual([])
  })
})

describe('shipped OpenAPI ruleset robustness (awkward documents)', () => {
  it('lints every sample without throwing', async () => {
    const ruleset = createOpenApiRuleset({ extends: [[oas, 'all']] })
    for (const document of DOCUMENTS) {
      await expect(lint(document, { ruleset, source: 'x.yaml' })).resolves.toBeDefined()
    }
  })

  it('fixes every sample without throwing, and always returns text', async () => {
    for (const document of DOCUMENTS) {
      const result = await fixDocument(document, {
        ruleset: { extends: [oas] } as RulesetDefinition,
        fixers: oasFixers,
        source: 'x.yaml',
      })
      expect(typeof result.output).toBe('string')
    }
  })
})
