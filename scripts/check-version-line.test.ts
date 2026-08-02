import { describe, expect, it } from 'vitest'

import { findVersionLineViolations } from './check-version-line'

const packages = [
  { name: '@amritk/helpers', version: '0.14.0' },
  { name: '@amritk/generate-parsers', version: '0.18.0' },
  { name: '@amritk/yaml', version: '0.4.0' },
]

describe('check-version-line', () => {
  it('passes when every pending release stays on 0.x', () => {
    const violations = findVersionLineViolations(packages, {
      releases: [
        { name: '@amritk/helpers', oldVersion: '0.14.0', newVersion: '0.15.0' },
        { name: '@amritk/yaml', oldVersion: '0.4.0', newVersion: '0.4.1' },
      ],
      changesets: [
        { id: 'a', releases: [{ name: '@amritk/helpers', type: 'minor' }] },
        { id: 'b', releases: [{ name: '@amritk/yaml', type: 'patch' }] },
      ],
    })

    expect(violations).toEqual([])
  })

  // The case that shipped: a `major` bump on a 0.x package resolves to 1.0.0,
  // and the changeset IDs are what the author has to go and edit.
  it('reports a package bumped to 1.0.0 along with the changesets behind it', () => {
    const violations = findVersionLineViolations(packages, {
      releases: [{ name: '@amritk/helpers', oldVersion: '0.14.0', newVersion: '1.0.0' }],
      changesets: [{ id: 'helpers-ref-naming-and-resolution', releases: [{ name: '@amritk/helpers', type: 'major' }] }],
    })

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
  // too; naming those as well would send the author through five innocent files.
  it('names only the changesets that asked for a major', () => {
    const violations = findVersionLineViolations(packages, {
      releases: [{ name: '@amritk/helpers', oldVersion: '0.14.0', newVersion: '1.0.0' }],
      changesets: [
        { id: 'guilty', releases: [{ name: '@amritk/helpers', type: 'major' }] },
        { id: 'innocent', releases: [{ name: '@amritk/helpers', type: 'patch' }] },
        { id: 'other-package', releases: [{ name: '@amritk/yaml', type: 'major' }] },
      ],
    })

    expect(violations[0]?.changesets).toEqual(['guilty'])
  })

  it('reports every offending package, not just the first', () => {
    const violations = findVersionLineViolations(packages, {
      releases: [
        { name: '@amritk/helpers', oldVersion: '0.14.0', newVersion: '1.0.0' },
        { name: '@amritk/generate-parsers', oldVersion: '0.18.0', newVersion: '1.0.0' },
        { name: '@amritk/yaml', oldVersion: '0.4.0', newVersion: '0.5.0' },
      ],
      changesets: [
        {
          id: 'a',
          releases: [
            { name: '@amritk/helpers', type: 'major' },
            { name: '@amritk/generate-parsers', type: 'major' },
          ],
        },
      ],
    })

    expect(violations.map((violation) => violation.name)).toEqual(['@amritk/helpers', '@amritk/generate-parsers'])
  })

  // A version can leave 0.x without any changeset asking it to — a hand edit,
  // or a release that already went out — and that never shows in the plan.
  it('catches a package.json already past 0.x with nothing pending', () => {
    const violations = findVersionLineViolations([{ name: '@amritk/helpers', version: '1.2.3' }], {
      releases: [],
      changesets: [],
    })

    expect(violations).toEqual([
      { name: '@amritk/helpers', currentVersion: '1.2.3', nextVersion: '1.2.3', changesets: [] },
    ])
  })

  it('treats a null status as nothing pending', () => {
    expect(findVersionLineViolations(packages, null)).toEqual([])
    expect(findVersionLineViolations([{ name: '@amritk/helpers', version: '2.0.0' }], null)).toHaveLength(1)
  })

  // 0.10.0 starts with "0.1" as a string, and a naive prefix test on the major
  // digit would read 10 as 1. Pin the boundary both ways.
  it('does not confuse 0.10.x with a 1.x version', () => {
    const violations = findVersionLineViolations([{ name: '@amritk/api', version: '0.9.0' }], {
      releases: [{ name: '@amritk/api', oldVersion: '0.9.0', newVersion: '0.10.0' }],
      changesets: [{ id: 'a', releases: [{ name: '@amritk/api', type: 'minor' }] }],
    })

    expect(violations).toEqual([])
  })

  it('flags a major beyond 1, not just 1.0.0 exactly', () => {
    const violations = findVersionLineViolations([{ name: '@amritk/api', version: '0.9.0' }], {
      releases: [{ name: '@amritk/api', oldVersion: '0.9.0', newVersion: '10.0.0' }],
      changesets: [{ id: 'a', releases: [{ name: '@amritk/api', type: 'major' }] }],
    })

    expect(violations.map((violation) => violation.nextVersion)).toEqual(['10.0.0'])
  })
})
