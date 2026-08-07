import { describe, expect, it } from 'vitest'

import { isScannableId } from './is-scannable-id'

describe('is-scannable-id', () => {
  it('accepts every script extension a contracts module can use', () => {
    for (const id of ['/app/src/contracts.ts', '/app/src/c.tsx', '/app/src/c.js', '/app/src/c.jsx']) {
      expect(isScannableId(id)).toBe(true)
    }
    // `.mts`/`.cts`/`.mjs`/`.cjs` too — a contracts file in a package that
    // pins its module format is still a contracts file.
    for (const id of ['/app/src/c.mts', '/app/src/c.cts', '/app/src/c.mjs', '/app/src/c.cjs']) {
      expect(isScannableId(id)).toBe(true)
    }
  })

  it('tolerates the query suffixes Vite appends to module ids', () => {
    expect(isScannableId('/app/src/contracts.ts?v=abc123')).toBe(true)
    expect(isScannableId('/app/src/contracts.ts?used&raw')).toBe(true)
  })

  it('rejects what cannot hold a defineContract call', () => {
    // Assets and stylesheets, and — the one that matters — virtual modules,
    // whose ids are not paths at all.
    for (const id of ['/app/src/app.css', '/app/src/data.json', '/app/logo.svg', '\0virtual:contracts']) {
      expect(isScannableId(id)).toBe(false)
    }
    // The extension has to end the id (or meet a query), so a directory named
    // for one does not drag its whole subtree into the scan.
    expect(isScannableId('/app/src.ts/README')).toBe(false)
  })
})
