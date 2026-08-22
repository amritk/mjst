import { describe, expect, it } from 'vitest'

import { asyncapi, createAsyncApiRuleset } from './index'

/**
 * The shipped ruleset, pinned rule by rule:
 * `<severity> <rec|opt> <resolved|unresolved> <formats>`,
 * where severity is the numeric `DiagnosticSeverity` (0 error, 1 warn, 2 info)
 * and `rec` means the rule is on in the default preset.
 *
 * This table exists because everything else in the suite tests rules through
 * their *effects*, which leaves the ruleset itself unguarded: fourteen rules
 * could be deleted outright, any rule's severity changed, and any rule dropped
 * from the recommended preset, with the whole suite still green. Those are all
 * silent, user-visible regressions, and a rule that no test names is a rule
 * nobody would notice losing.
 *
 * Updating this table is the point, not a chore — a diff here is a diff in what
 * consumers get, and it belongs in the changeset.
 */
const MANIFEST: Record<string, string> = {
  'asyncapi-3-channel-no-empty-parameter': '1 rec resolved aas3',
  'asyncapi-3-channel-no-query-nor-fragment': '1 rec resolved aas3',
  'asyncapi-3-channel-no-trailing-slash': '1 rec resolved aas3',
  'asyncapi-3-channel-servers': '0 rec unresolved aas3',
  'asyncapi-3-document-unresolved': '0 rec unresolved aas3',
  'asyncapi-3-headers-schema-type-object': '0 rec resolved aas3',
  'asyncapi-3-operation-description': '1 rec resolved aas3',
  'asyncapi-3-operation-security': '0 rec unresolved aas3',
  'asyncapi-3-payload-unsupported-schemaFormat': '2 rec unresolved aas3',
  'asyncapi-3-server-no-empty-variable': '1 rec resolved aas3',
  'asyncapi-3-server-no-trailing-slash': '1 rec resolved aas3',
  'asyncapi-3-server-not-example-com': '1 opt resolved aas3',
  'asyncapi-3-tag-description': '1 opt resolved aas3',
  'asyncapi-3-tags': '1 rec resolved aas3',
  'asyncapi-3-tags-alphabetical': '1 opt resolved aas3',
  'asyncapi-3-tags-uniqueness': '0 rec unresolved aas3',
  'asyncapi-channel-no-empty-parameter': '1 rec resolved aas2',
  'asyncapi-channel-no-query-nor-fragment': '1 rec resolved aas2',
  'asyncapi-channel-no-trailing-slash': '1 rec resolved aas2',
  'asyncapi-channel-parameters': '0 rec unresolved aas2+aas3',
  'asyncapi-channel-servers': '0 rec unresolved aas2',
  'asyncapi-headers-schema-type-object': '0 rec resolved aas2',
  'asyncapi-info-contact': '1 rec resolved aas2+aas3',
  'asyncapi-info-contact-properties': '1 rec resolved aas2+aas3',
  'asyncapi-info-description': '1 rec resolved aas2+aas3',
  'asyncapi-info-license': '1 rec resolved aas2+aas3',
  'asyncapi-info-license-url': '1 opt resolved aas2+aas3',
  'asyncapi-latest-version': '2 rec resolved aas2+aas3',
  'asyncapi-message-examples': '0 rec resolved aas2',
  'asyncapi-message-messageId-uniqueness': '0 rec unresolved aas2',
  'asyncapi-operation-description': '1 rec resolved aas2',
  'asyncapi-operation-operationId': '0 rec resolved aas2',
  'asyncapi-operation-operationId-uniqueness': '0 rec unresolved aas2',
  'asyncapi-operation-security': '0 rec resolved aas2',
  'asyncapi-parameter-description': '1 opt resolved aas2+aas3',
  'asyncapi-payload': '0 rec resolved aas2',
  'asyncapi-payload-default': '0 rec resolved aas2',
  'asyncapi-payload-examples': '0 rec resolved aas2',
  'asyncapi-payload-unsupported-schemaFormat': '2 rec unresolved aas2',
  'asyncapi-schema': '0 rec unresolved aas2',
  'asyncapi-schema-default': '0 rec resolved aas2',
  'asyncapi-schema-examples': '0 rec resolved aas2',
  'asyncapi-server-no-empty-variable': '1 rec resolved aas2',
  'asyncapi-server-no-trailing-slash': '1 rec resolved aas2',
  'asyncapi-server-not-example-com': '1 opt resolved aas2',
  'asyncapi-server-security': '0 rec resolved aas2',
  'asyncapi-server-variables': '0 rec unresolved aas2',
  'asyncapi-servers': '1 rec resolved aas2+aas3',
  'asyncapi-tag-description': '1 opt resolved aas2',
  'asyncapi-tags': '1 rec resolved aas2',
  'asyncapi-tags-alphabetical': '1 opt resolved aas2',
  'asyncapi-tags-uniqueness': '0 rec unresolved aas2',
  'asyncapi-unused-components-schema': '1 rec unresolved aas2+aas3',
  'asyncapi-unused-components-server': '1 rec unresolved aas2+aas3',
}

describe('the shipped ruleset', () => {
  const all = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
  const recommended = new Set(
    createAsyncApiRuleset()
      .rules.filter((rule) => rule.enabled)
      .map((rule) => rule.name),
  )
  const describeRule = (rule: (typeof all.rules)[number]): string =>
    [
      rule.severity,
      recommended.has(rule.name) ? 'rec' : 'opt',
      // Whether a rule sees the dereferenced tree decides whether one authored
      // mistake is reported once or once per `$ref` reaching it, so it belongs
      // in the manifest as much as severity does.
      rule.resolved ? 'resolved' : 'unresolved',
      rule.formats ? [...rule.formats].sort().join('+') : 'both',
    ].join(' ')

  it('ships exactly the rules in the manifest, with the same severity and gating', () => {
    const actual = Object.fromEntries(all.rules.map((rule) => [rule.name, describeRule(rule)]))
    expect(actual).toEqual(MANIFEST)
  })

  it('ships the rule count the changeset advertises', () => {
    expect(all.rules).toHaveLength(54)
    expect(recommended.size).toBe(46)
  })

  it('names every 3.x-only rule with the asyncapi-3- prefix, and no other rule', () => {
    for (const rule of all.rules) {
      const formats = rule.formats ? [...rule.formats] : []
      const only3 = formats.length === 1 && formats[0] === 'aas3'
      expect(rule.name.startsWith('asyncapi-3-'), rule.name).toBe(only3)
    }
  })

  it('gives every rule a description and a known function', () => {
    for (const rule of all.rules) {
      expect(rule.description, rule.name).toBeTruthy()
      for (const then of rule.then) {
        if (typeof then.function === 'string') {
          expect(all.getFunction(then.function), `${rule.name} -> ${then.function}`).toBeDefined()
        }
      }
    }
  })
})
