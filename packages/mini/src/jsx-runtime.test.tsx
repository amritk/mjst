// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { signal } from './signals'

describe('jsx-runtime', () => {
  it('creates real elements with static attributes and children', () => {
    const el = (
      <div class="card" data-kind="product">
        <span>hello</span> world {42}
      </div>
    )
    expect(el).toBeInstanceOf(HTMLElement)
    expect(el.className).toBe('card')
    expect(el.getAttribute('data-kind')).toBe('product')
    expect(el.textContent).toBe('hello world 42')
  })

  it('treats a signal-valued attribute as a live binding', () => {
    const disabled = signal(false)
    // The whole point of the runtime: pass the signal, do NOT call it.
    const el = (
      <button type="button" disabled={disabled}>
        go
      </button>
    )
    expect(el.hasAttribute('disabled')).toBe(false)
    disabled(true)
    expect(el.getAttribute('disabled')).toBe('')
    disabled(false)
    expect(el.hasAttribute('disabled')).toBe(false)
  })

  it('freezes a called signal — the documented footgun', () => {
    const disabled = signal(true)
    const el = (
      <button type="button" disabled={disabled()}>
        go
      </button>
    )
    disabled(false)
    // Static forever: the call handed the runtime a plain boolean.
    expect(el.hasAttribute('disabled')).toBe(true)
  })

  it('renders a thunk child as reactive text', () => {
    const count = signal(2)
    const el = <span>{() => count() * 2}</span>
    expect(el.textContent).toBe('4')
    count(5)
    expect(el.textContent).toBe('10')
  })

  it('keeps sibling children intact while a reactive text child updates', () => {
    const label = signal('a')
    const el = (
      <p>
        <b>fixed</b>
        {() => label()}
      </p>
    )
    const bold = el.querySelector('b')
    label('b')
    expect(el.querySelector('b')).toBe(bold)
    expect(el.textContent).toBe('fixedb')
  })

  it('drops null, undefined, and boolean children so && conditionals work', () => {
    const show = false
    const el = (
      <div>
        {show && <span>never</span>}
        {null}
        {undefined}
        kept
      </div>
    )
    expect(el.querySelector('span')).toBeNull()
    expect(el.textContent).toBe('kept')
  })

  it('attaches on* props as event listeners', () => {
    const clicks: string[] = []
    const el = (
      <button type="button" onClick={() => clicks.push('hit')}>
        go
      </button>
    )
    el.click()
    el.click()
    expect(clicks).toEqual(['hit', 'hit'])
  })

  it('calls ref with the fully built element', () => {
    let seen: HTMLElement | undefined
    const el = (
      <div
        class="outer"
        ref={(node) => {
          seen = node
        }}
      >
        <i>child</i>
      </div>
    )
    expect(seen).toBe(el)
    // The ref ran after children were appended, so wiring in a ref callback
    // can rely on the subtree existing.
    expect(seen?.querySelector('i')).not.toBeNull()
  })

  it('runs a component function exactly once and returns its element', () => {
    let runs = 0
    const Chip = ({ label }: { label: string }): HTMLElement => {
      runs += 1
      return <span class="chip">{label}</span>
    }
    const el = (
      <div>
        <Chip label="hi" />
      </div>
    )
    expect(runs).toBe(1)
    expect(el.querySelector('.chip')?.textContent).toBe('hi')
  })

  it('removes an attribute when a reactive value returns null', () => {
    const title = signal<string | null>('tip')
    const el = <div title={() => title()} />
    expect(el.getAttribute('title')).toBe('tip')
    title(null)
    expect(el.hasAttribute('title')).toBe(false)
  })

  it('toggles display through a reactive show prop', () => {
    const visible = signal(true)
    const el = <div show={visible}>content</div>
    expect(el.style.display).toBe('')
    visible(false)
    expect(el.style.display).toBe('none')
    visible(true)
    expect(el.style.display).toBe('')
  })

  it('honours a static show prop', () => {
    const el = <div show={false}>hidden</div>
    expect(el.style.display).toBe('none')
  })

  it('narrows currentTarget to the bound element in event handlers', () => {
    let width = -1
    const el = (
      <button
        type="button"
        onClick={(event) => {
          // event.currentTarget is typed HTMLButtonElement — no cast — so
          // reading a button-specific property typechecks.
          width = event.currentTarget.clientWidth
        }}
      >
        go
      </button>
    )
    el.click()
    expect(width).toBe(0)
  })
})
