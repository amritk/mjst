import { describe, expect, it } from 'vitest'

import { findCalledSignalBindings } from './catch-called-signals'

describe('catch-called-signals', () => {
  it('flags an attribute whose value is a called signal', () => {
    const found = findCalledSignalBindings('const a = <button disabled={streaming()}>x</button>')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ attribute: 'disabled', callee: 'streaming' })
  })

  it('flags a called signal reached through a member access', () => {
    const found = findCalledSignalBindings('const f = <input checked={form.isSubmitting()} />')
    expect(found).toMatchObject([{ attribute: 'checked', callee: 'form.isSubmitting' }])
  })

  it('flags a called signal reached through an optional chain', () => {
    const found = findCalledSignalBindings('const f = <input checked={form?.dirty()} />')
    expect(found).toMatchObject([{ attribute: 'checked', callee: 'form?.dirty' }])
  })

  it('flags an attribute that spans multiple lines', () => {
    // The parser does not care about formatting, so a wrapped attribute is
    // caught where a line-oriented scan would miss it.
    const source = ['const k = (', '  <button', '    disabled={streaming()}', '  >go</button>', ')'].join('\n')
    expect(findCalledSignalBindings(source)).toMatchObject([{ attribute: 'disabled', callee: 'streaming', line: 3 }])
  })

  it('flags an on* handler that is invoked instead of passed', () => {
    // `onClick={handleClick()}` runs the handler once at creation — the same
    // class of bug as a frozen signal, so it belongs in the report too.
    const found = findCalledSignalBindings('const i = <button onClick={handleClick()}>go</button>')
    expect(found).toMatchObject([{ attribute: 'onClick', callee: 'handleClick' }])
  })

  it('leaves the bare getter alone', () => {
    expect(findCalledSignalBindings('const b = <button disabled={streaming}>y</button>')).toEqual([])
  })

  it('leaves a thunk-wrapped call alone', () => {
    // A derived binding is correct — the call lives inside the getter mini runs.
    expect(findCalledSignalBindings('const e = <button disabled={() => streaming()}>ok</button>')).toEqual([])
  })

  it('leaves an event handler arrow alone', () => {
    expect(findCalledSignalBindings('const d = <button onClick={() => count(count() + 1)}>h</button>')).toEqual([])
  })

  it('leaves a partial expression alone', () => {
    // We only match when the whole value is one call, so `{count() + 1}` is a
    // deliberate miss rather than a risk of warning on legitimate code.
    expect(findCalledSignalBindings('const g = <button value={count() + 1}>x</button>')).toEqual([])
  })

  it('ignores the footgun when it appears inside a comment', () => {
    // mini's jsx-runtime documents `disabled={streaming()}` in JSDoc; because
    // the scanner walks the AST, a comment is never parsed as JSX, so the
    // teaching example cannot trip it.
    const source = [
      '/**',
      ' *     <button disabled={streaming()}>',
      ' */',
      '// bad: <button disabled={streaming()}>',
      'const ok = <button disabled={streaming}>y</button>',
    ].join('\n')
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('ignores the footgun when it appears inside a string', () => {
    // A parser sees a string literal, not markup — only real JSX is scanned.
    expect(findCalledSignalBindings('const doc = "use disabled={streaming()} carefully"')).toEqual([])
  })

  it('reports a 1-based line and column', () => {
    const source = '\n  const c = <button id={makeId()}>z</button>'
    expect(findCalledSignalBindings(source)[0]).toMatchObject({ line: 2, column: 21 })
  })

  it('skips a binding suppressed on the same line', () => {
    const source = 'const a = <button disabled={streaming()}>x</button> // catch-called-signals-ignore'
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('skips a binding suppressed on the line above', () => {
    const source =
      '// catch-called-signals-ignore: intentional frozen value\nconst a = <button disabled={streaming()}>x</button>'
    expect(findCalledSignalBindings(source)).toEqual([])
  })

  it('finds every binding in a file', () => {
    const source = [
      '<button disabled={streaming()}>a</button>',
      '<button disabled={paused}>b</button>',
      '<input checked={form.dirty()} />',
    ].join('\n')
    expect(findCalledSignalBindings(source).map((binding) => binding.callee)).toEqual(['streaming', 'form.dirty'])
  })
})
