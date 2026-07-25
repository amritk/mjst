// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { clearHost, mount, setHost, signal } from '../index'
import { createDomHost, domRoot } from './create-dom-host'

/**
 * The DOM host is the only part of the framework that knows what a browser is,
 * so it is also the only suite that needs one — hence the environment pragma
 * above. Everything else runs against the in-memory host with no platform at
 * all, in the default node environment where `document` does not exist.
 */
afterEach(() => {
  clearHost()
})

/** Builds a fresh container element to mount into. */
const container = (): Element => document.createElement('div')

describe('create-dom-host', () => {
  it('maps the element vocabulary onto HTML tags', () => {
    setHost(createDomHost())
    const root = container()

    mount(domRoot(root), () => (
      <view>
        <text>hello</text>
        <image src="/puck.png" />
      </view>
    ))

    // `view` is a div and `text` is a span — the browser is the guest here,
    // rendering a native vocabulary rather than defining it.
    expect(root.innerHTML).toBe('<div><span>hello</span><img src="/puck.png"></div>')
  })

  it('maps native gesture names onto DOM events', () => {
    setHost(createDomHost())
    const root = container()
    let taps = 0

    mount(domRoot(root), () => <view onTap={() => taps++} />)
    ;(root.firstChild as HTMLElement).click()

    expect(taps).toBe(1)
  })

  it('updates reactive text without rebuilding the element', () => {
    setHost(createDomHost())
    const root = container()
    const name = signal('sam')

    mount(domRoot(root), () => <text>{() => `hi ${name()}`}</text>)
    const span = root.firstChild as HTMLElement

    expect(span.textContent).toBe('hi sam')
    name('alex')
    expect(span.textContent).toBe('hi alex')
    // Same node throughout: there is no re-render, only a text mutation.
    expect(root.firstChild).toBe(span)
  })

  it('applies a style bag with camelCase keys converted to CSS names', () => {
    setHost(createDomHost())
    const root = container()

    mount(domRoot(root), () => <view style={{ paddingTop: '4px', flexGrow: 1 }} />)

    const element = root.firstChild as HTMLElement
    expect(element.style.getPropertyValue('padding-top')).toBe('4px')
    expect(element.style.getPropertyValue('flex-grow')).toBe('1')
  })

  it('renames vocabulary props that spell differently in HTML', () => {
    setHost(createDomHost())
    const root = container()

    mount(domRoot(root), () => <input testId="email" keyboard="email" />)

    const element = root.firstChild as HTMLElement
    expect(element.getAttribute('data-testid')).toBe('email')
    expect(element.getAttribute('type')).toBe('email')
  })

  it('hides an element in place rather than detaching it', () => {
    setHost(createDomHost())
    const root = container()
    const visible = signal(true)

    mount(domRoot(root), () => <view show={visible} />)
    const element = root.firstChild as HTMLElement

    visible(false)
    expect(element.style.display).toBe('none')
    expect(root.childNodes).toHaveLength(1)
  })

  it('gives the flow wrapper display contents so it leaves layout alone', () => {
    // On the web the wrapper has to disappear from layout or it would break the
    // parent's flex or grid flow. Native hosts need no such trick.
    setHost(createDomHost())
    const host = createDomHost()
    const wrapper = host.createFlowHost() as unknown as HTMLElement

    expect(wrapper.style.display).toBe('contents')
  })

  it('detaches the tree when the mount is disposed', () => {
    setHost(createDomHost())
    const root = container()

    const dispose = mount(domRoot(root), () => <view />)
    dispose()

    expect(root.innerHTML).toBe('')
  })
})
