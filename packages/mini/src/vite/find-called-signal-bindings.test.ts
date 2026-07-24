import { describe, expect, it } from 'vitest'

import { findCalledSignalBindings } from './find-called-signal-bindings'

describe('find-called-signal-bindings', () => {
  it('flags a signal called directly in an attribute', () => {
    const found = findCalledSignalBindings(
      'const streaming = signal(false)\nconst a = <button disabled={streaming()}>x</button>',
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ attribute: 'disabled', callee: 'streaming', line: 2 })
  })

  it('flags a signal called directly as a JSX child', () => {
    // A bare `{count}` child is already reactive, so `{count()}` is the frozen
    // mistake — the same footgun, one position over. Child findings carry no
    // attribute name.
    const found = findCalledSignalBindings('const count = signal(0)\nconst a = <span>{count()}</span>')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ callee: 'count', line: 2 })
    expect(found[0]?.attribute).toBeUndefined()
  })

  it('recognises computed and Signal-typed parameters', () => {
    const source =
      'const doubled = computed(() => 1)\nconst Row = (p: { active: Signal<boolean> }) => <li class={doubled()} />'
    expect(findCalledSignalBindings(source)).toMatchObject([{ attribute: 'class', callee: 'doubled' }])
  })

  it('does not flag a call to a name it cannot see is a signal', () => {
    // `makeId` is not a signal, so `id={makeId()}` is a one-shot value, not the
    // reactivity footgun — the false positive a shape-only scan would raise.
    expect(findCalledSignalBindings('const a = <button id={makeId()}>x</button>')).toEqual([])
  })

  it('ignores files with no signals entirely', () => {
    expect(findCalledSignalBindings('const a = <button disabled={foo()}>x</button>')).toEqual([])
  })

  it('flags a signal attribute that spans multiple lines', () => {
    // The parser does not care about formatting, so a wrapped attribute is
    // caught where a line-oriented scan would miss it.
    const source = [
      'const streaming = signal(false)',
      'const k = (',
      '  <button',
      '    disabled={streaming()}',
      '  >go</button>',
      ')',
    ].join('\n')
    expect(findCalledSignalBindings(source)).toMatchObject([{ attribute: 'disabled', callee: 'streaming', line: 4 }])
  })

  it('leaves the bare getter alone', () => {
    expect(
      findCalledSignalBindings('const streaming = signal(false)\nconst b = <button disabled={streaming}>y</button>'),
    ).toEqual([])
  })

  it('leaves a thunk-wrapped call alone', () => {
    // A derived binding is correct — the call lives inside the getter mini runs.
    expect(
      findCalledSignalBindings('const s = signal(false)\nconst e = <button disabled={() => s()}>ok</button>'),
    ).toEqual([])
  })

  it('leaves an event handler alone', () => {
    const source = 'const count = signal(0)\nconst d = <button onClick={() => count(count() + 1)}>h</button>'
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('does not flag a signal called in an on* handler value', () => {
    // `onClick` is an event slot, not a reactive binding — out of scope.
    expect(findCalledSignalBindings('const go = signal(false)\nconst a = <button onClick={go()}>x</button>')).toEqual(
      [],
    )
  })

  it('flags a signal call inside a larger expression', () => {
    // `{count() + 1}` still calls the signal at the JSX site and freezes — the
    // scanner catches a signal call anywhere in a non-getter value.
    const found = findCalledSignalBindings('const count = signal(0)\nconst g = <button value={count() + 1}>x</button>')
    expect(found).toHaveLength(1)
    expect(found[0]?.callee).toBe('count')
    expect(found[0]?.attribute).toBe('value')
  })

  it('flags a signal called inside a ternary', () => {
    const found = findCalledSignalBindings(
      "const active = signal(false)\nconst g = <div class={active() ? 'on' : 'off'}>x</div>",
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.callee).toBe('active')
    expect(found[0]?.attribute).toBe('class')
  })

  it('flags a signal called inside a logical expression', () => {
    const found = findCalledSignalBindings(
      'const busy = signal(false)\nconst g = <button disabled={busy() || false}>x</button>',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.callee).toBe('busy')
  })

  it('flags a signal called inside a style object literal', () => {
    const found = findCalledSignalBindings('const w = signal(1)\nconst g = <div style={{ width: w() }}>x</div>')
    expect(found).toHaveLength(1)
    expect(found[0]?.callee).toBe('w')
    expect(found[0]?.attribute).toBe('style')
  })

  it('flags a signal called inside a template literal child', () => {
    const found = findCalledSignalBindings('const n = signal(0)\nconst g = <span>{`count: ${n()}`}</span>')
    expect(found).toHaveLength(1)
    expect(found[0]?.callee).toBe('n')
    expect(found[0]?.attribute).toBeUndefined()
  })

  it('leaves a signal called inside a nested arrow alone', () => {
    // The call lives in a `.map` callback — a getter boundary — so it is the
    // reactive form, not a freeze.
    expect(
      findCalledSignalBindings(
        'const items = signal<number[]>([])\nconst g = <ul>{() => items().map((i) => i)}</ul>',
      ),
    ).toEqual([])
  })

  it('does not flag an attribute named like an event but not a handler', () => {
    // `online` starts with "on" but is not an `on<Capital>` handler, so a called
    // signal there is still a real freeze worth flagging.
    const found = findCalledSignalBindings('const up = signal(true)\nconst g = <div online={up()}>x</div>')
    expect(found).toHaveLength(1)
    expect(found[0]?.attribute).toBe('online')
  })

  it('leaves a bare signal child alone', () => {
    expect(findCalledSignalBindings('const count = signal(0)\nconst a = <span>{count}</span>')).toEqual([])
  })

  it('ignores the footgun when it appears inside a comment', () => {
    // The scanner walks the AST, so a comment is never parsed as JSX.
    const source = [
      'const streaming = signal(false)',
      '// bad: <button disabled={streaming()}>',
      'const ok = <button disabled={streaming}>y</button>',
    ].join('\n')
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('ignores the footgun when it appears inside a string', () => {
    const source = 'const streaming = signal(false)\nconst doc = "use disabled={streaming()} carefully"'
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('reports a 1-based line and column', () => {
    const source = 'const makeId = signal("")\n  const c = <button id={makeId()}>z</button>'
    expect(findCalledSignalBindings(source)[0]).toMatchObject({ line: 2, column: 21 })
  })

  it('skips a binding suppressed on the same line', () => {
    const source = 'const s = signal(false)\nconst a = <button disabled={s()}>x</button> // mini-static-ok'
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('skips a binding suppressed on the line above', () => {
    const source =
      'const s = signal(false)\n// mini-static-ok: intentional frozen value\nconst a = <button disabled={s()}>x</button>'
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('finds every binding in a file', () => {
    const source = [
      'const streaming = signal(false)',
      'const dirty = signal(false)',
      'const a = <button disabled={streaming()}>a</button>',
      'const b = <button disabled={paused}>b</button>',
      'const c = <input checked={dirty()} />',
    ].join('\n')
    expect(findCalledSignalBindings(source).map((binding) => binding.callee)).toEqual(['streaming', 'dirty'])
  })
})
