// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import type { ClassValue } from './jsx-runtime'
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
    // biome-ignore format: keep the binding and its static-read marker on one line
    const el = <button type="button" disabled={disabled()}>go</button> // mini-static-ok: asserts the footgun on purpose
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

  it('creates SVG elements in the SVG namespace so they render', () => {
    const icon = (
      <svg viewBox="0 0 16 16" width={16} role="img" aria-label="box">
        <title>box</title>
        <path d="M0 0h16v16H0z" fill="currentColor" />
      </svg>
    )
    // A plain createElement would put these in the HTML namespace and draw
    // nothing; createElementNS is what makes them real SVG.
    expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(icon.getAttribute('viewBox')).toBe('0 0 16 16')
    const path = icon.querySelector('path')
    expect(path?.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(path?.getAttribute('d')).toBe('M0 0h16v16H0z')
  })

  it('types and applies the extended form-control attributes', () => {
    const el = (
      <input
        type="number"
        name="quantity"
        min={0}
        max={10}
        step={1}
        required
        readonly
        multiple
        accept=".csv,text/csv"
      />
    )
    expect(el.getAttribute('name')).toBe('quantity')
    expect(el.getAttribute('min')).toBe('0')
    expect(el.getAttribute('max')).toBe('10')
    expect(el.getAttribute('step')).toBe('1')
    expect(el.hasAttribute('required')).toBe(true)
    expect(el.hasAttribute('readonly')).toBe(true)
    expect(el.getAttribute('accept')).toBe('.csv,text/csv')
  })

  it('types select and option value attributes', () => {
    const el = (
      <select name="pick" disabled={false}>
        <option value="a" selected>
          A
        </option>
        <option value="b">B</option>
      </select>
    )
    const options = el.querySelectorAll('option')
    expect(options[0]?.getAttribute('value')).toBe('a')
    expect(options[1]?.getAttribute('value')).toBe('b')
  })

  it('resolves an array class dropping falsy entries', () => {
    const active = false
    const el = <div class={['card', active && 'active', 'lg']} />
    expect(el.className).toBe('card lg')
  })

  it('flattens a nested class array and drops every falsy entry', () => {
    const shared = ['b', { c: true, d: false }]
    const el = <div class={['a', shared, false, null]} />
    // Without recursion the nested array is stringified where it stands, and
    // `String(['b', …])` produces the single comma-joined class name 'b,c'.
    expect(el.className).toBe('a b c')

    // `0` sits outside the declared type but well inside what untyped call sites
    // hand over (`count && 'badge'` produces one), and resolving entries by
    // stringifying before testing them would turn it into the class name "0".
    const loose = ['a', 0, 'b'] as unknown as ClassValue
    expect((<div class={loose} />).className).toBe('a b')
  })

  it('resolves an object class by truthy keys, reactively', () => {
    const open = signal(false)
    const el = <div class={() => ({ panel: true, open: open() })} />
    expect(el.className).toBe('panel')
    open(true)
    expect(el.className).toBe('panel open')
  })

  it('applies an object style, camelCase keys kebab-cased', () => {
    const el = <div style={{ color: 'red', fontSize: '12px' }} />
    expect(el.style.color).toBe('red')
    expect(el.style.getPropertyValue('font-size')).toBe('12px')
  })

  it('gives a bare style number pixels, except where CSS is unitless', () => {
    const el = <div style={{ width: 100, marginTop: 8, opacity: 0.5, zIndex: 3, lineHeight: 1.5, '--gap': 4 }} />
    // `setProperty('width', '100')` is not valid CSS, so an unconverted number
    // used to be dropped on the floor without a word.
    expect(el.style.getPropertyValue('width')).toBe('100px')
    expect(el.style.getPropertyValue('margin-top')).toBe('8px')
    // Ratios, counts, and multipliers break if a unit is appended.
    expect(el.style.getPropertyValue('opacity')).toBe('0.5')
    expect(el.style.getPropertyValue('z-index')).toBe('3')
    expect(el.style.getPropertyValue('line-height')).toBe('1.5')
    // A custom property means whatever its author says, so no unit is guessed.
    expect(el.style.getPropertyValue('--gap')).toBe('4')
  })

  it('keeps a style write from un-hiding what show hid, and restores the bag display', () => {
    const visible = signal(true)
    const width = signal(10)
    // `show` and `style` write the same inline `display` slot: hiding sets
    // `display: none`, and applying the bag replaces the inline style wholesale.
    const el = <div show={visible} style={() => ({ width: `${width()}px`, display: 'flex' })} />
    expect(el.style.display).toBe('flex')
    visible(false)
    expect(el.style.display).toBe('none')
    // The style update must not bring the element back into view.
    width(20)
    expect(el.style.getPropertyValue('width')).toBe('20px')
    expect(el.style.display).toBe('none')
    // Showing it again restores what the bag asked for, not a hardcoded ''.
    visible(true)
    expect(el.style.display).toBe('flex')
  })

  it('settles show against a static style whichever order the props were written in', () => {
    // Props are iterated in object order, so without arbitration the behaviour
    // depends on which attribute happened to be typed first — here `style`
    // lands before `show` ever runs.
    const visible = signal(true)
    const el = <div style={{ display: 'inline-block' }} show={visible} />
    expect(el.style.display).toBe('inline-block')
    visible(false)
    expect(el.style.display).toBe('none')
    visible(true)
    expect(el.style.display).toBe('inline-block')
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
