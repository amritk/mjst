import { parseTree } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'

import { loadOpenApiFixtures } from '../../../../fixtures/openapi/load-fixtures'
import { createTreeLocator, parseJson } from './json'
import { createJsonLocator } from './json-locator'
import { createLineMap } from './lines'
import type { JsonPath } from './types'

/**
 * The lazy locator replaced a `jsonc-parser` tree for valid JSON, and a
 * finding's range is user-visible output: every path it answers has to land
 * on exactly the range the tree gave. Each case below is checked against the
 * tree locator over every path in the document, plus paths that leave it.
 */
const treeLocator = (source: string) => {
  const root = parseTree(source, [], { allowTrailingComma: false, disallowComments: true })
  if (!root) throw new Error('no tree')
  return createTreeLocator(root, createLineMap(source))
}

/** Every path in `value`, plus paths that step off it in each way a lookup can. */
const pathsOf = (value: unknown): JsonPath[] => {
  const paths: JsonPath[] = [[], ['missing'], [0], ['0']]
  const stack: { value: unknown; path: JsonPath }[] = [{ value, path: [] }]
  while (stack.length > 0) {
    const { value: current, path } = stack.pop() as { value: unknown; path: JsonPath }
    if (typeof current !== 'object' || current === null) {
      paths.push([...path, 'below-a-scalar'])
      continue
    }
    paths.push([...path, 'missing', 'deeper'])
    if (Array.isArray(current)) {
      paths.push([...path, current.length], [...path, -1], [...path, '01'], [...path, 'length'])
      current.forEach((item, index) => {
        paths.push([...path, index], [...path, String(index)])
        stack.push({ value: item, path: [...path, index] })
      })
    } else {
      for (const [key, item] of Object.entries(current)) {
        const numeric = /^\d+$/.test(key) ? Number(key) : undefined
        paths.push([...path, key])
        // Findings spell an all-digit key such as a `"200"` response as a number.
        if (numeric !== undefined) paths.push([...path, numeric])
        stack.push({ value: item, path: [...path, key] })
      }
    }
  }
  return paths
}

const expectSameRanges = (source: string): void => {
  const lazy = createJsonLocator(source)
  const tree = treeLocator(source)
  const mismatches: unknown[] = []
  for (const path of pathsOf(JSON.parse(source))) {
    for (const closest of [false, true]) {
      const got = lazy(path, closest)?.range
      const want = tree(path, closest)?.range
      if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push({ path, closest, got, want })
    }
  }
  expect(mismatches.slice(0, 5)).toEqual([])
}

describe('json-locator', () => {
  it('matches the tree on every vendored OpenAPI document, in several layouts', () => {
    for (const fixture of loadOpenApiFixtures()) {
      if (fixture.name.endsWith('openai.yaml')) continue // 2.8 MB: covered by the layouts below on smaller inputs
      // The tree locator scans siblings linearly, so the larger documents get one layout.
      const layouts =
        fixture.format === 'json' || fixture.source.length > 50_000
          ? [fixture.format === 'json' ? fixture.source : JSON.stringify(fixture.document, null, 2)]
          : [
              JSON.stringify(fixture.document),
              JSON.stringify(fixture.document, null, 2),
              JSON.stringify(fixture.document, null, '\t').replace(/\n/g, '\r\n'),
            ]
      for (const layout of layouts) expectSameRanges(layout)
    }
  })

  it('finds the first of duplicate keys, as the tree does', () => {
    expectSameRanges('{"a": 1, "b": {"c": 2}, "a": {"d": [3]}}')
  })

  it('compares keys decoded', () => {
    expectSameRanges('{"\\u0061": 1, "a": 2, "q\\"uote": {"x\\\\": "y"}, "\\ud83d\\ude00": [true]}')
  })

  it('skips brackets and escaped quotes inside strings', () => {
    expectSameRanges('{"s": "[{\\"]}", "t": "\\\\", "u": {"v": "}"}, "w": ["]", "\\\\\\""]}')
  })

  it('handles scalars, empty containers and whitespace around the root', () => {
    for (const source of [
      ' \n 42 \n',
      '"text"',
      'null',
      '[]',
      '{}',
      '\t[ ]\r\n',
      '{ "a" : { } , "b" : [ ] , "c" : -1.5e+3 , "d" : false }',
      '[[[1, [2]], {"x": [3, {"y": null}]}], -0, 1E9]',
    ]) {
      expectSameRanges(source)
    }
  })

  it('agrees with the tree on random documents', () => {
    let seed = 7
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    const KEYS = ['a', 'b', '200', '0', 'x y', 'é', 'q"', 'back\\slash', '[', '{}', '']
    const value = (depth: number): unknown => {
      const kind = depth > 4 ? rand(4) : rand(6)
      if (kind === 0) return rand(1000) - 500
      if (kind === 1) return KEYS[rand(KEYS.length)]
      if (kind === 2) return [true, false, null][rand(3)]
      if (kind === 3) return rand(2) === 0 ? 1.5e-7 : '[{"\\'
      if (kind === 4) return Array.from({ length: rand(4) }, () => value(depth + 1))
      return Object.fromEntries(Array.from({ length: rand(5) }, () => [KEYS[rand(KEYS.length)], value(depth + 1)]))
    }
    for (let i = 0; i < 300; i++) {
      const document = value(0)
      expectSameRanges(JSON.stringify(document, null, rand(3)))
    }
  })

  it('backs parseJson for valid input and leaves invalid input to the tree', () => {
    const valid = parseJson('{"a": [1, 2]}')
    expect(valid.diagnostics).toEqual([])
    expect(valid.getLocationForJsonPath(['a', 1])?.range).toEqual({
      start: { line: 0, character: 10 },
      end: { line: 0, character: 11 },
    })

    // A trailing comma is not JSON: the tree parser recovers the data and says why.
    const invalid = parseJson('{"a": [1, 2],}')
    expect(invalid.data).toEqual({ a: [1, 2] })
    expect(invalid.diagnostics.length).toBeGreaterThan(0)
    expect(invalid.getLocationForJsonPath(['a', 1])?.range.start).toEqual({ line: 0, character: 10 })
  })
})
