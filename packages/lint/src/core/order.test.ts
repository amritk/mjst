import { describe, expect, it } from 'vitest'

import { withoutDuplicates } from './order'
import type { IDiagnostic } from './types'

describe('withoutDuplicates', () => {
  const at = (line: number, code: string, message: string, severity = 0): IDiagnostic => ({
    code,
    message,
    severity: severity as IDiagnostic['severity'],
    path: [],
    range: { start: { line, character: 2 }, end: { line, character: 9 } },
  })

  it('keeps one of a run of indistinguishable findings', () => {
    expect(withoutDuplicates([at(3, 'a', 'boom'), at(3, 'a', 'boom'), at(3, 'a', 'boom')])).toHaveLength(1)
  })

  it('keeps findings that differ in anything a reader can see', () => {
    const distinct = [
      at(3, 'a', 'boom'),
      at(4, 'a', 'boom'),
      at(3, 'b', 'boom'),
      at(3, 'a', 'different'),
      at(3, 'a', 'boom', 1),
      { ...at(3, 'a', 'boom'), source: 'other.yaml' },
    ]
    expect(withoutDuplicates(distinct)).toHaveLength(distinct.length)
  })

  it('keeps findings whose only difference is the path they were reached by', () => {
    // Two paths, one node: a `$ref`'d component reported at its declaration and
    // at a use site. The reader sees the same line and the same words, so one
    // survives — and it is the first, so ordering is stable.
    const declaration = { ...at(3, 'a', 'boom'), path: ['components', 'messages', 'M'] }
    const useSite = { ...at(3, 'a', 'boom'), path: ['channels', 'c', 'subscribe', 'message'] }
    const kept = withoutDuplicates([declaration, useSite])
    expect(kept).toEqual([declaration])
  })

  it('preserves order and leaves an empty list alone', () => {
    const ordered = [at(1, 'a', 'one'), at(2, 'b', 'two'), at(3, 'c', 'three')]
    expect(withoutDuplicates(ordered)).toEqual(ordered)
    expect(withoutDuplicates([])).toEqual([])
  })
})
