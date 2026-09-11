import { describe, expect, it } from 'vitest'
import { readExtraColumns } from '#helpers/extra-columns'

describe('extra-columns', () => {
  it('reads a keyword to header map', () => {
    expect(readExtraColumns({ 'x-scalar-stability': 'Stability' })).toEqual([
      { key: 'x-scalar-stability', label: 'Stability' },
    ])
  })

  // The order of the columns is the author's decision, so it is the order they
  // wrote them in rather than anything this package sorts by.
  it('keeps the declaration order', () => {
    const columns = readExtraColumns({ 'x-since': 'Since', 'x-scalar-stability': 'Stability' })
    expect(columns.map((column) => column.key)).toEqual(['x-since', 'x-scalar-stability'])
  })

  it('has no columns when the schema declares none', () => {
    expect(readExtraColumns(undefined)).toEqual([])
  })

  // The declaration comes from parsed JSON, never validated input.
  it('ignores a declaration that is not an object', () => {
    expect(readExtraColumns('x-scalar-stability')).toEqual([])
    expect(readExtraColumns(['x-scalar-stability'])).toEqual([])
    expect(readExtraColumns(null)).toEqual([])
  })

  // A header the reader cannot read is worse than no column at all.
  it('skips an entry whose header is not a non-empty string', () => {
    expect(readExtraColumns({ 'x-a': '', 'x-b': 42, 'x-c': null, 'x-d': 'Kept' })).toEqual([
      { key: 'x-d', label: 'Kept' },
    ])
  })
})
