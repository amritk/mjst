import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { spliceBenchDelta, START, END } = require('./splice-bench-delta.cjs') as {
  spliceBenchDelta: (body: string | null | undefined, table: string) => string
  START: string
  END: string
}

const TABLE = `${START}\ntable v2\n${END}`

describe('splice-bench-delta', () => {
  it('appends to a body without markers', () => {
    expect(spliceBenchDelta('My description.', TABLE)).toBe(`My description.\n\n${TABLE}\n`)
  })

  it('handles a null/empty body', () => {
    expect(spliceBenchDelta(null, TABLE)).toBe(`${TABLE}\n`)
    expect(spliceBenchDelta('', TABLE)).toBe(`${TABLE}\n`)
  })

  it('replaces an existing block in place, preserving surrounding text', () => {
    const body = `Intro.\n\n${START}\nold table\n${END}\n\nOutro.`
    expect(spliceBenchDelta(body, TABLE)).toBe(`Intro.\n\n${TABLE}\n\nOutro.`)
  })

  it('is idempotent across successive runs', () => {
    const once = spliceBenchDelta('Description.', TABLE)
    expect(spliceBenchDelta(once, TABLE)).toBe(once)
  })

  // Review pin: a dangling start marker (end marker deleted by hand) used to
  // poison the NEXT run — its indexOf paired the stale start with the freshly
  // appended block's end and spliced away every hand-written line in between.
  it('repairs a dangling start marker instead of eating the description later', () => {
    const body = `Intro.\n\n${START}\n\nHand-written notes that must survive.`
    const afterFirstRun = spliceBenchDelta(body, TABLE)

    expect(afterFirstRun).toContain('Hand-written notes that must survive.')
    expect(afterFirstRun).toContain('Intro.')

    const afterSecondRun = spliceBenchDelta(afterFirstRun, TABLE)
    expect(afterSecondRun).toContain('Hand-written notes that must survive.')
    expect(afterSecondRun).toContain('Intro.')
    // Exactly one well-formed block remains.
    expect(afterSecondRun.split(START).length).toBe(2)
    expect(afterSecondRun.split(END).length).toBe(2)
  })

  it('repairs a stray end marker before the start marker', () => {
    const body = `${END} stray\n\nKeep me.\n\n${START}`
    const result = spliceBenchDelta(body, TABLE)
    expect(result).toContain('Keep me.')
    expect(result.split(START).length).toBe(2)
    expect(result.split(END).length).toBe(2)
  })
})
