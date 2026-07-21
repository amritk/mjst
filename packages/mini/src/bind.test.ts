// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { bindAttr, bindChecked, bindClass, bindHtml, bindSelect, bindShow, bindText, bindValue } from './bind'
import { signal } from './signals'

describe('bind', () => {
  it('bindText tracks the signal', () => {
    const label = signal('a')
    const node = document.createElement('span')
    bindText(node, label)
    expect(node.textContent).toBe('a')
    label('b')
    expect(node.textContent).toBe('b')
  })

  it('bindText cannot inject markup', () => {
    const label = signal('<img src=x onerror=alert(1)>')
    const node = document.createElement('span')
    bindText(node, label)
    expect(node.querySelector('img')).toBeNull()
  })

  it('bindAttr sets, clears, and bare-sets attributes', () => {
    const state = signal<string | boolean | null>('hello')
    const node = document.createElement('input')
    bindAttr(node, 'placeholder', state)
    expect(node.getAttribute('placeholder')).toBe('hello')
    state(null)
    expect(node.hasAttribute('placeholder')).toBe(false)
    state(true)
    expect(node.getAttribute('placeholder')).toBe('')
    state(false)
    expect(node.hasAttribute('placeholder')).toBe(false)
  })

  it('bindClass toggles the class with the getter', () => {
    const on = signal(false)
    const node = document.createElement('div')
    bindClass(node, 'active', on)
    expect(node.classList.contains('active')).toBe(false)
    on(true)
    expect(node.classList.contains('active')).toBe(true)
  })

  it('bindShow switches inline display', () => {
    const visible = signal(true)
    const node = document.createElement('div')
    bindShow(node, visible)
    expect(node.style.display).toBe('')
    visible(false)
    expect(node.style.display).toBe('none')
  })

  it('bindHtml renders only what the sanitizer returns', () => {
    const content = signal('raw')
    const node = document.createElement('div')
    const seen: string[] = []
    bindHtml(
      node,
      (raw) => {
        seen.push(raw)
        return '<b>clean</b>'
      },
      content,
    )
    // Every value must flow through the sanitizer, and only its output may
    // reach innerHTML — this is the widget's XSS boundary.
    expect(seen).toEqual(['raw'])
    expect(node.innerHTML).toBe('<b>clean</b>')
  })

  it('bindValue drives the element value from the signal', () => {
    const model = signal('hello')
    const node = document.createElement('input')
    bindValue(node, model)
    expect(node.value).toBe('hello')
    model('world')
    expect(node.value).toBe('world')
  })

  it('bindValue writes the signal back on input events', () => {
    const model = signal('')
    const node = document.createElement('input')
    bindValue(node, model)
    node.value = 'typed'
    node.dispatchEvent(new Event('input'))
    expect(model()).toBe('typed')
  })

  it('bindValue dispose stops both directions', () => {
    const model = signal('a')
    const node = document.createElement('input')
    const dispose = bindValue(node, model)
    dispose()
    // Signal → element stops.
    model('b')
    expect(node.value).toBe('a')
    // Element → signal stops.
    node.value = 'c'
    node.dispatchEvent(new Event('input'))
    expect(model()).toBe('b')
  })

  it('stops updating after the returned stop function is called', () => {
    const label = signal('a')
    const node = document.createElement('span')
    const stop = bindText(node, label)
    stop()
    label('b')
    expect(node.textContent).toBe('a')
  })

  it('bindValue holds the signal back during IME composition, committing on end', () => {
    const model = signal('')
    const node = document.createElement('input')
    bindValue(node, model)
    node.dispatchEvent(new Event('compositionstart'))
    // Mid-composition input must NOT reach the signal — it would tear the
    // candidate string apart on CJK/accented entry.
    node.value = 'partial'
    node.dispatchEvent(new Event('input'))
    expect(model()).toBe('')
    // The finished text commits once on compositionend.
    node.value = 'final'
    node.dispatchEvent(new Event('compositionend'))
    expect(model()).toBe('final')
  })

  it('bindChecked drives the checkbox from the signal and back', () => {
    const on = signal(false)
    const node = document.createElement('input')
    node.type = 'checkbox'
    bindChecked(node, on)
    expect(node.checked).toBe(false)
    on(true)
    expect(node.checked).toBe(true)
    // Toggling the box writes the signal on change.
    node.checked = false
    node.dispatchEvent(new Event('change'))
    expect(on()).toBe(false)
  })

  it('bindChecked dispose stops both directions', () => {
    const on = signal(true)
    const node = document.createElement('input')
    node.type = 'checkbox'
    const dispose = bindChecked(node, on)
    expect(node.checked).toBe(true)
    dispose()
    // Signal → element stops.
    on(false)
    expect(node.checked).toBe(true)
    // Element → signal stops: toggling the box no longer writes the signal.
    node.checked = true
    node.dispatchEvent(new Event('change'))
    expect(on()).toBe(false)
  })

  const buildSelect = (values: readonly string[]): HTMLSelectElement => {
    const select = document.createElement('select')
    for (const value of values) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = value
      select.appendChild(option)
    }
    return select
  }

  it('bindSelect drives the dropdown from the signal and back', () => {
    const model = signal('b')
    const node = buildSelect(['a', 'b', 'c'])
    bindSelect(node, model)
    // The property (not a bare attribute) is set, so the option is selected.
    expect(node.value).toBe('b')
    model('c')
    expect(node.value).toBe('c')
    // Choosing an option writes the signal on change.
    node.value = 'a'
    node.dispatchEvent(new Event('change'))
    expect(model()).toBe('a')
  })

  it('bindSelect dispose stops both directions', () => {
    const model = signal('a')
    const node = buildSelect(['a', 'b'])
    const dispose = bindSelect(node, model)
    expect(node.value).toBe('a')
    dispose()
    // Signal → element stops.
    model('b')
    expect(node.value).toBe('a')
    // Element → signal stops: choosing an option no longer writes the signal.
    node.value = 'a'
    node.dispatchEvent(new Event('change'))
    expect(model()).toBe('b')
  })
})
