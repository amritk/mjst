import { resolveRefs } from '@amritk/resolve-refs'
import { describe, expect, it } from 'vitest'

import { loadAsyncApiFixtures } from '../../../../../fixtures/asyncapi/load-fixtures'
import { type LintResolver, lint } from '../../core'
import { asyncapi, createAsyncApiRuleset } from './index'

// Robustness smoke test: run the whole preset (every rule, including the broad
// recursive-descent payload/example givens) against the vendored real-world
// documents. This guards against a rule throwing or mis-behaving on real
// specs, and confirms findings always carry a concrete source range.
const allRules = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
const fixtures = loadAsyncApiFixtures()

/** Dereferences internal `$ref`s so the `resolved: true` rules see a real tree. */
const resolve: LintResolver = (document) => ({ resolved: resolveRefs(document.data).resolved })

describe('asyncapi fixtures', () => {
  it('loads the vendored 2.6 and 3.0 documents', () => {
    expect(fixtures.filter((fixture) => fixture.name.startsWith('v2.6/')).length).toBeGreaterThan(0)
    expect(fixtures.filter((fixture) => fixture.name.startsWith('v3.0/')).length).toBeGreaterThan(0)
  })

  for (const fixture of fixtures) {
    it(`lints ${fixture.name} without throwing, with ranged findings`, async () => {
      const findings = await lint(fixture.source, { ruleset: allRules, resolve })
      for (const finding of findings) {
        expect(finding.range.start.line, finding.code as string).toBeGreaterThanOrEqual(0)
        expect(typeof finding.code).toBe('string')
      }
    })

    it(`recognises the version ${fixture.name} declares`, async () => {
      // Every fixture is a real document of a version we bundle a schema for, so
      // the structural rule must have had something to validate against — a
      // silent "unknown version, nothing to say" would make the suite vacuous.
      const declared = fixture.document['asyncapi']
      expect(typeof declared).toBe('string')
      const structural = fixture.name.startsWith('v3.0/') ? 'asyncapi-3-document-unresolved' : 'asyncapi-schema'
      const findings = await lint(fixture.source, { ruleset: allRules, resolve })
      // Published examples are structurally valid, so the structural rule is
      // silent on them — that is the assertion, not merely "no crash".
      expect(findings.filter((finding) => finding.code === structural)).toEqual([])
    })
  }

  it('finds the same style problems in a document written for both majors', async () => {
    // The streetlights API is published in both 2.6 and 3.0 form. The rules are
    // split by major, so a rule that is gated to the wrong one shows up here as
    // a finding on one version and not the other.
    const findingsFor = async (name: string): Promise<Set<string>> => {
      const fixture = fixtures.find((candidate) => candidate.name === name)
      expect(fixture, name).toBeDefined()
      const findings = await lint(fixture?.source ?? '', { ruleset: allRules, resolve })
      return new Set(findings.map((finding) => String(finding.code)))
    }
    const two = await findingsFor('v2.6/streetlights-kafka.yaml')
    const three = await findingsFor('v3.0/streetlights-kafka.yaml')

    // Neither version of a published example may fail a structural rule.
    for (const codes of [two, three]) {
      expect(codes.has('asyncapi-schema')).toBe(false)
      expect(codes.has('asyncapi-3-document-unresolved')).toBe(false)
      expect(codes.has('asyncapi-3-document-resolved')).toBe(false)
      expect(codes.has('asyncapi-payload')).toBe(false)
      expect(codes.has('asyncapi-channel-parameters')).toBe(false)
    }
    // The 2.6 document is not the latest version; the 3.0 one is.
    expect(two.has('asyncapi-latest-version')).toBe(true)
    expect(three.has('asyncapi-latest-version')).toBe(false)
  })

  it('validates the content behind a $ref only when a resolver is injected', async () => {
    // A message whose payload is a `$ref` at a broken component schema.
    // Unresolved, the payload is just a well-formed Reference Object and the
    // payload rule has nothing to object to; resolved, it is the broken schema.
    const doc = JSON.stringify({
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: {
        'user/signedup': {
          subscribe: { operationId: 'x', message: { messageId: 'm', payload: { $ref: '#/components/schemas/S' } } },
        },
      },
      components: { schemas: { S: { type: 'nope' } } },
    })
    const withResolver = new Set((await lint(doc, { ruleset: allRules, resolve })).map((finding) => finding.code))
    const without = new Set((await lint(doc, { ruleset: allRules })).map((finding) => finding.code))
    expect(withResolver.has('asyncapi-payload')).toBe(true)
    expect(without.has('asyncapi-payload')).toBe(false)
  })

  it('checks a 3.0 operation channel only the resolver can reach', async () => {
    // The published 3.0 schema types `operations.*.channel` as a Reference, so
    // the unresolved pass never looks past the pointer. Behind it here is a
    // channel whose `address` is a number.
    const doc = JSON.stringify({
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      channels: { user: { address: 42 } },
      operations: { onSignup: { action: 'receive', channel: { $ref: '#/channels/user' } } },
    })
    const withResolver = (await lint(doc, { ruleset: allRules, resolve })).map((finding) => finding.code)
    expect(withResolver).toContain('asyncapi-3-document-resolved')
  })
})
