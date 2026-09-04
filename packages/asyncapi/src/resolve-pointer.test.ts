import { describe, expect, it } from 'vitest'

import { getByPointer, resolveNode } from './resolve-pointer'
import type { ExtractionIssue } from './types'

const document = {
  components: {
    messages: { userSignedUp: { name: 'userSignedUp' } },
    'odd~key': { 'with/slash': 'found' },
    chained: { $ref: '#/components/messages/userSignedUp' },
    cycleA: { $ref: '#/components/cycleB' },
    cycleB: { $ref: '#/components/cycleA' },
  },
  list: ['zero', 'one'],
}

describe('resolve-pointer', () => {
  it('follows object and array segments', () => {
    expect(getByPointer(document, '#/components/messages/userSignedUp')).toEqual({ name: 'userSignedUp' })
    expect(getByPointer(document, '#/list/1')).toBe('one')
    expect(getByPointer(document, '#')).toBe(document)
  })

  it('unescapes ~0 and ~1 segments', () => {
    expect(getByPointer(document, '#/components/odd~0key/with~1slash')).toBe('found')
  })

  it('returns undefined for dangling and malformed pointers', () => {
    expect(getByPointer(document, '#/components/missing')).toBeUndefined()
    expect(getByPointer(document, '#/list/9')).toBeUndefined()
    expect(getByPointer(document, '#/list/one')).toBeUndefined()
    expect(getByPointer(document, 'components/messages')).toBeUndefined()
    // Prototype members are not document content.
    expect(getByPointer(document, '#/components/constructor')).toBeUndefined()
  })

  it('resolves chained refs to the final node', () => {
    const issues: ExtractionIssue[] = []
    const node = resolveNode(document, { $ref: '#/components/chained' }, issues, '#/x')
    expect(node).toEqual({ name: 'userSignedUp' })
    expect(issues).toEqual([])
  })

  it('passes a plain object through untouched', () => {
    const issues: ExtractionIssue[] = []
    const plain = { name: 'inline' }
    expect(resolveNode(document, plain, issues, '#/x')).toBe(plain)
    expect(issues).toEqual([])
  })

  it('reports external refs, cycles, and dangling pointers as issues', () => {
    const issues: ExtractionIssue[] = []
    expect(resolveNode(document, { $ref: './other.yaml#/x' }, issues, '#/a')).toBeUndefined()
    expect(resolveNode(document, { $ref: '#/components/cycleA' }, issues, '#/b')).toBeUndefined()
    expect(resolveNode(document, { $ref: '#/nope' }, issues, '#/c')).toBeUndefined()
    expect(resolveNode(document, 'not-an-object', issues, '#/d')).toBeUndefined()
    expect(issues.map((issue) => issue.path)).toEqual(['#/a', '#/b', '#/c', '#/d'])
  })
})
