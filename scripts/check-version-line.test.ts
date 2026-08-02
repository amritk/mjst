import { describe, expect, it } from 'vitest'

import { findVersionLineViolations } from './check-version-line'

const packages = [
  { name: '@amritk/helpers', version: '0.14.0' },
  { name: '@amritk/generate-parsers', version: '0.18.0' },
  { name: '@amritk/yaml', version: '0.4.0' },
]

describe('check-version-line', () => {
  it('passes when no changeset asks for a major', () => {
    const violations = findVersionLineViolations(packages, [
      { id: 'a', releases: [{ name: '@amritk/helpers', type: 'minor' }] },
      { id: 'b', releases: [{ name: '@amritk/yaml', type: 'patch' }] },
    ])

    expect(violations).toEqual([])
  })

  it('passes when there are no changesets at all', () => {
    expect(findVersionLineViolations(packages, [])).toEqual([])
  })

  // The case that shipped: a `major` bump on a 0.x package resolves to 1.0.0,
  // and the changeset ID is what the author has to go and edit.
  it('reports a package headed for 1.0.0 with the changeset behind it', () => {
    const violations = findVersionLineViolations(packages, [
      { id: 'helpers-ref-naming-and-resolution', releases: [{ name: '@amritk/helpers', type: 'major' }] },
    ])

    expect(violations).toEqual([
      {
        name: '@amritk/helpers',
        currentVersion: '0.14.0',
        nextVersion: '1.0.0',
        changesets: ['helpers-ref-naming-and-resolution'],
      },
    ])
  })

  // The release that goes 1.0.0 usually collects a pile of ordinary patches
  // too; naming those as well would send the author through innocent files.
  it('names only the changesets that asked for a major', () => {
    const violations = findVersionLineViolations(packages, [
      { id: 'guilty', releases: [{ name: '@amritk/helpers', type: 'major' }] },
      { id: 'innocent', releases: [{ name: '@amritk/helpers', type: 'patch' }] },
      { id: 'other-package', releases: [{ name: '@amritk/yaml', type: 'major' }] },
    ])

    expect(violations.map((violation) => violation.name)).toEqual(['@amritk/helpers', '@amritk/yaml'])
    expect(violations[0]?.changesets).toEqual(['guilty'])
  })

  it('collects every changeset asking for a major on the same package', () => {
    const violations = findVersionLineViolations(packages, [
      { id: 'first', releases: [{ name: '@amritk/helpers', type: 'major' }] },
      { id: 'second', releases: [{ name: '@amritk/helpers', type: 'major' }] },
    ])

    expect(violations[0]?.changesets).toEqual(['first', 'second'])
  })

  it('reports every offending package, not just the first', () => {
    const violations = findVersionLineViolations(packages, [
      {
        id: 'a',
        releases: [
          { name: '@amritk/helpers', type: 'major' },
          { name: '@amritk/generate-parsers', type: 'major' },
        ],
      },
    ])

    expect(violations.map((violation) => violation.name)).toEqual(['@amritk/helpers', '@amritk/generate-parsers'])
  })

  // A version can leave 0.x without any changeset asking it to — a hand edit,
  // or a release that already went out — and no pending bump explains it.
  it('catches a package.json already past 0.x with nothing pending', () => {
    const violations = findVersionLineViolations([{ name: '@amritk/helpers', version: '1.2.3' }], [])

    expect(violations).toEqual([
      { name: '@amritk/helpers', currentVersion: '1.2.3', nextVersion: '1.2.3', changesets: [] },
    ])
  })

  // 0.10.0 starts with "0.1" as a string, and a naive prefix test on the major
  // digit would read 10 as 1.
  it('does not confuse 0.10.x with a 1.x version', () => {
    const violations = findVersionLineViolations(
      [{ name: '@amritk/api', version: '0.10.0' }],
      [{ id: 'a', releases: [{ name: '@amritk/api', type: 'minor' }] }],
    )

    expect(violations).toEqual([])
  })

  it('ignores a major aimed at a package it does not know', () => {
    const violations = findVersionLineViolations(packages, [
      { id: 'a', releases: [{ name: '@amritk/does-not-exist', type: 'major' }] },
    ])

    expect(violations).toEqual([])
  })
})
