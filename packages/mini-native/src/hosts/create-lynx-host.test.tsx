import { afterEach, describe, expect, it } from 'vitest'

import type { HostElement } from '../index'
import { clearHost, mount, setHost, signal } from '../index'
import { createLynxHost, lynxRoot } from './create-lynx-host'
import type { LynxElement, LynxElementApi } from './lynx-element-api'

/** A node in the fake engine tree. Mirrors the shape the real PAPI maintains. */
type FakeElement = {
  tag: string
  attrs: Record<string, unknown>
  styles: Record<string, string>
  classes: string
  events: Map<string, ((event: unknown) => void) | null>
  children: FakeElement[]
  parent: FakeElement | null
}

type FakeEngine = {
  api: LynxElementApi
  root: FakeElement
  /** How many times the tree has been committed, for asserting flush coalescing. */
  flushes: () => number
}

/**
 * A stand-in for the Lynx engine.
 *
 * The whole reason `createLynxHost` takes its PAPI as an argument is so this can
 * exist: the adapter's mapping is verified here in full — element creation,
 * text representation, event registration, tree surgery — with no engine, no
 * device, and no emulator anywhere in the loop.
 */
const createFakeEngine = (): FakeEngine => {
  let flushes = 0

  const element = (tag: string): FakeElement => ({
    tag,
    attrs: {},
    styles: {},
    classes: '',
    events: new Map(),
    children: [],
    parent: null,
  })

  const root = element('page')

  const api: LynxElementApi = {
    __CreateElement: (tag) => toLynx(element(tag)),
    __SetAttribute: (el, name, value) => {
      const target = fromLynx(el)
      if (value === null) delete target.attrs[name]
      else target.attrs[name] = value
    },
    __GetAttributes: (el) => fromLynx(el).attrs,
    __SetInlineStyles: (el, styles) => {
      fromLynx(el).styles = typeof styles === 'string' ? {} : { ...styles }
    },
    __AddInlineStyle: (el, name, value) => {
      fromLynx(el).styles[name] = String(value)
    },
    __SetClasses: (el, classes) => {
      fromLynx(el).classes = classes
    },
    __AppendElement: (parent, child) => {
      const target = fromLynx(parent)
      const node = fromLynx(child)
      target.children.push(node)
      node.parent = target
    },
    __InsertElementBefore: (parent, child, anchor) => {
      const target = fromLynx(parent)
      const node = fromLynx(child)
      const at = target.children.indexOf(fromLynx(anchor))
      target.children.splice(at === -1 ? target.children.length : at, 0, node)
      node.parent = target
    },
    __RemoveElement: (parent, child) => {
      const target = fromLynx(parent)
      const node = fromLynx(child)
      const at = target.children.indexOf(node)
      if (at !== -1) target.children.splice(at, 1)
      node.parent = null
    },
    __GetParent: (el) => {
      const parent = fromLynx(el).parent
      return parent === null ? null : toLynx(parent)
    },
    __GetChildren: (el) => fromLynx(el).children.map(toLynx),
    __FirstElement: (el) => {
      const first = fromLynx(el).children[0]
      return first === undefined ? null : toLynx(first)
    },
    __NextElement: (el) => {
      const node = fromLynx(el)
      const siblings = node.parent?.children
      if (!siblings) return null
      const next = siblings[siblings.indexOf(node) + 1]
      return next === undefined ? null : toLynx(next)
    },
    __AddEvent: (el, type, name, listener) => {
      fromLynx(el).events.set(`${type}:${name}`, listener)
    },
    __FlushElementTree: () => {
      flushes++
    },
  }

  return { api, root, flushes: () => flushes }
}

const toLynx = (node: FakeElement): LynxElement => node as unknown as LynxElement
const fromLynx = (node: LynxElement): FakeElement => node as unknown as FakeElement

/**
 * Looks behind the opaque handle the host hands back, so a test can assert on
 * what the fake engine actually recorded.
 */
const asFake = (node: HostElement): FakeElement => node as unknown as FakeElement

/** Installs the Lynx host over a fresh fake engine and returns both. */
const setup = (): FakeEngine => {
  const engine = createFakeEngine()
  setHost(createLynxHost(engine.api))
  return engine
}

/** Fires whatever dispatcher the host registered for an event name. */
const fire = (element: FakeElement, name: string, event: unknown = {}): void => {
  element.events.get(`bindEvent:${name}`)?.(event)
}

afterEach(() => {
  clearHost()
})

describe('create-lynx-host', () => {
  it('creates elements under component id zero', () => {
    const engine = setup()
    mount(lynxRoot(toLynx(engine.root)), () => <view />)

    expect(engine.root.children[0]?.tag).toBe('view')
  })

  it('represents text as a raw-text element carrying a text attribute', () => {
    const engine = setup()
    mount(lynxRoot(toLynx(engine.root)), () => <text>hello</text>)

    const raw = engine.root.children[0]?.children[0]
    expect(raw?.tag).toBe('raw-text')
    expect(raw?.attrs['text']).toBe('hello')
  })

  it('updates text in place when the signal it reads changes', () => {
    const engine = setup()
    const name = signal('sam')
    mount(lynxRoot(toLynx(engine.root)), () => <text>{() => `hi ${name()}`}</text>)

    const raw = engine.root.children[0]?.children[0]
    expect(raw?.attrs['text']).toBe('hi sam')
    name('alex')
    expect(raw?.attrs['text']).toBe('hi alex')
  })

  it('routes class through SetClasses rather than an attribute', () => {
    // Classes are not attributes in Lynx, so passing them through
    // `__SetAttribute` would set something the engine simply ignores.
    const engine = setup()
    mount(lynxRoot(toLynx(engine.root)), () => <view class={['card', 'wide']} />)

    const view = engine.root.children[0]
    expect(view?.classes).toBe('card wide')
    expect(view?.attrs['class']).toBeUndefined()
  })

  it('fans out to every listener despite the engine keeping only one', () => {
    // Lynx overwrites a listener when a second is registered for the same
    // event. The host registers one dispatcher and fans out itself, so callers
    // get the add-many behaviour every other host provides.
    const engine = setup()
    const calls: string[] = []
    const host = createLynxHost(engine.api)
    const element = host.createElement('view')

    host.addEventListener(element, 'tap', () => calls.push('first'))
    host.addEventListener(element, 'tap', () => calls.push('second'))
    fire(asFake(element), 'tap')

    expect(calls).toEqual(['first', 'second'])
  })

  it('keeps the remaining listeners when one detaches', () => {
    const engine = setup()
    const calls: string[] = []
    const host = createLynxHost(engine.api)
    const element = host.createElement('view')

    const detach = host.addEventListener(element, 'tap', () => calls.push('first'))
    host.addEventListener(element, 'tap', () => calls.push('second'))
    detach()
    fire(asFake(element), 'tap')

    expect(calls).toEqual(['second'])
  })

  it('unregisters the dispatcher once the last listener detaches', () => {
    const engine = setup()
    const host = createLynxHost(engine.api)
    const element = host.createElement('view')

    const detach = host.addEventListener(element, 'tap', () => undefined)
    detach()

    // A null listener is how Lynx is told to drop the registration, so the
    // engine stops calling into an empty handler set on every gesture.
    expect(asFake(element).events.get('bindEvent:tap')).toBeNull()
  })

  it('hides an element by setting display none and restores it to flex', () => {
    const engine = setup()
    const visible = signal(true)
    mount(lynxRoot(toLynx(engine.root)), () => <view show={visible} />)

    const view = engine.root.children[0]
    expect(view?.styles['display']).toBe('flex')
    visible(false)
    expect(view?.styles['display']).toBe('none')
  })

  it('detaches a node from its old parent when inserting it elsewhere', () => {
    const engine = setup()
    const host = createLynxHost(engine.api)
    const first = host.createElement('view')
    const second = host.createElement('view')
    const child = host.createElement('text')

    host.insert(first, child, null)
    host.insert(second, child, null)

    // Without the detach, the node would end up listed under both parents,
    // which is exactly what a list reorder would trigger.
    expect(fromLynx(first as unknown as LynxElement).children).toHaveLength(0)
    expect(fromLynx(second as unknown as LynxElement).children).toHaveLength(1)
  })

  it('coalesces a burst of mutations into a single commit', async () => {
    const engine = setup()
    const count = signal(0)
    mount(lynxRoot(toLynx(engine.root)), () => <text>{() => String(count())}</text>)

    await Promise.resolve()
    const afterMount = engine.flushes()

    count(1)
    count(2)
    count(3)
    await Promise.resolve()

    // Three writes, one commit. On a batching engine the alternative is a
    // whole-tree commit per attribute, which is the difference between a cheap
    // update and a stutter.
    expect(engine.flushes()).toBe(afterMount + 1)
  })
})
