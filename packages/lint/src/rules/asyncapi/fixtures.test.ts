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

  it('reports each structural error exactly once, resolver or not', async () => {
    // Regression: the 3.x structural check used to be a resolved/unresolved
    // pair, so every structural error in a 3.0 document was reported twice as
    // soon as a `$ref` resolver was injected — which the CLI always does.
    const doc = JSON.stringify(
      {
        asyncapi: '3.0.0',
        info: { title: 'T', version: '1.0.0' },
        channels: { user: { address: 'user/x', messages: { m: { payload: { type: 'object' } } } } },
        operations: { o: { action: 'shout', channel: { $ref: '#/channels/user' } } },
      },
      null,
      2,
    )
    const structural = (findings: { code: string | number }[]): (string | number)[] =>
      findings.map((finding) => finding.code).filter((code) => String(code).startsWith('asyncapi-3-document'))

    const withResolver = structural(await lint(doc, { ruleset: allRules, resolve }))
    const without = structural(await lint(doc, { ruleset: allRules }))
    expect(withResolver.length).toBeGreaterThan(0)
    expect(withResolver).toEqual(without)
  })

  it('does not multiply a structural error by the number of $refs reaching it', async () => {
    // A reusable message with one mistake, referenced from two channels. The
    // structural rule runs unresolved precisely so this stays one finding
    // rather than one per reference site.
    const doc = JSON.stringify(
      {
        asyncapi: '2.6.0',
        info: { title: 'T', version: '1.0.0' },
        channels: {
          a: { subscribe: { operationId: 'a', message: { $ref: '#/components/messages/M' } } },
          b: { subscribe: { operationId: 'b', message: { $ref: '#/components/messages/M' } } },
        },
        components: { messages: { M: { messageId: 42 } } },
      },
      null,
      2,
    )
    const findings = await lint(doc, { ruleset: allRules, resolve })
    expect(findings.filter((finding) => finding.code === 'asyncapi-schema')).toHaveLength(1)
  })

  it('does not invent a duplicate id for a component reused through $ref', async () => {
    // Regression: the uniqueness rules walked the dereferenced tree, so one
    // reusable message reached by two `$ref`s looked like two declarations of
    // the same messageId and errored on a perfectly valid document.
    const doc = JSON.stringify(
      {
        asyncapi: '2.6.0',
        info: { title: 'T', version: '1.0.0' },
        channels: {
          a: { subscribe: { operationId: 'a', message: { $ref: '#/components/messages/M' } } },
          b: { subscribe: { operationId: 'b', message: { $ref: '#/components/messages/M' } } },
        },
        components: { messages: { M: { messageId: 'shared', payload: { type: 'object' } } } },
      },
      null,
      2,
    )
    const codes = (await lint(doc, { ruleset: allRules, resolve })).map((finding) => finding.code)
    expect(codes).not.toContain('asyncapi-message-messageId-uniqueness')
  })
})
