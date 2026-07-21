// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { bindAttr, bindClass, bindHtml, bindShow, bindText, bindValue } from './bind'
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
})
