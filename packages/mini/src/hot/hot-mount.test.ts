// @vitest-environment happy-dom

import type { ViteHotContext } from 'vite/types/hot.js'
import { describe, expect, it } from 'vitest'

import { bindText } from '../bind'
import { onCleanup } from '../on-cleanup'
import { signal } from '../signals'
import { type HotContext, hotMount } from './hot-mount'

/**
 * Vite's hot runtime only exists inside a running dev server, so the seam is
 * faked here — but faithfully: `accept` marks the module a boundary, one
 * disposer is kept (a second registration replaces the first, exactly as Vite
 * does), and `update` replays the real sequence, running the old module's
 * teardown *before* the updated module executes. That ordering is what
 * `hotMount` depends on, so the fake would be worthless without it.
 */
type FakeHot = HotContext & {
  /** Whether the module registered itself as a hot-update boundary. */
  readonly isAccepted: () => boolean
  /** Replays an update: tear the old module down, then run the new one. */
  readonly update: (nextModule: () => void) => void
}

const createFakeHot = (): FakeHot => {
  let accepted = false
  let disposer: (() => void) | undefined
  return {
    accept: () => {
      accepted = true
    },
    dispose: (callback) => {
      disposer = callback
    },
    isAccepted: () => accepted,
    update: (nextModule) => {
      disposer?.()
      nextModule()
    },
  }
}

/** A component rendering `text`, which records the same string in `torn` when its scope disposes. */
const paragraph = (text: string, torn: string[]) => () => {
  const el = document.createElement('p')
  el.textContent = text
  onCleanup(() => torn.push(text))
  return el
}

describe('hot-mount', () => {
  it('mounts and returns a working dispose when there is no hot context', () => {
    // The production build path: `import.meta.hot` is undefined and this must
    // behave exactly like `mount`, so the entry needs no build-mode branch.
    const container = document.createElement('div')
    const torn: string[] = []
    const dispose = hotMount(container, paragraph('built', torn), undefined)

    expect(container.textContent).toBe('built')
    dispose()
    expect(container.children).toHaveLength(0)
    expect(torn).toEqual(['built'])
  })

  it('accepts the module so an edit hot-updates instead of reloading the page', () => {
    const container = document.createElement('div')
    const hot = createFakeHot()
    hotMount(container, paragraph('live', []), hot)

    expect(hot.isAccepted()).toBe(true)
  })

  it('disposes the mounted tree before the updated module mounts the next one', () => {
    const container = document.createElement('div')
    const hot = createFakeHot()
    const torn: string[] = []
    const label = signal('first')

    hotMount(
      container,
      () => {
        const el = document.createElement('p')
        bindText(el, label)
        onCleanup(() => torn.push('first'))
        return el
      },
      hot,
    )
    const firstNode = container.firstElementChild as HTMLElement
    expect(firstNode.textContent).toBe('first')

    hot.update(() => {
      // Asserted inside the update because the ordering is the whole contract:
      // by the time the edited entry re-runs, the old tree is already gone.
      expect(container.children).toHaveLength(0)
      expect(torn).toEqual(['first'])
      hotMount(container, paragraph('second', torn), hot)
    })

    expect(container.children).toHaveLength(1)
    expect(container.textContent).toBe('second')
    // The first tree's scope died with it, so the shared signal no longer
    // writes into the detached node — no ghost bindings accumulating per edit.
    label('after-reload')
    expect(firstNode.textContent).toBe('first')
  })

  it('keeps disposing across repeated updates', () => {
    const container = document.createElement('div')
    const hot = createFakeHot()
    const torn: string[] = []

    hotMount(container, paragraph('v1', torn), hot)
    hot.update(() => hotMount(container, paragraph('v2', torn), hot))
    hot.update(() => hotMount(container, paragraph('v3', torn), hot))

    // Each pass re-registers its own disposer, so the boundary never goes stale.
    expect(torn).toEqual(['v1', 'v2'])
    expect(container.children).toHaveLength(1)
    expect(container.textContent).toBe('v3')
  })

  it('accepts the module before mounting, so a throwing component still leaves a boundary', () => {
    const container = document.createElement('div')
    const hot = createFakeHot()

    expect(() =>
      hotMount(
        container,
        () => {
          throw new Error('broken render')
        },
        hot,
      ),
    ).toThrow('broken render')

    // Without this, a typo would drop the boundary and the *fix* would arrive
    // as a full page reload — the moment hot reloading is most wanted.
    expect(hot.isAccepted()).toBe(true)
  })

  it('survives a manual dispose followed by an update', () => {
    const container = document.createElement('div')
    const hot = createFakeHot()
    const torn: string[] = []

    const dispose = hotMount(container, paragraph('manual', torn), hot)
    dispose()
    expect(container.children).toHaveLength(0)

    // The runtime still holds that same dispose and will call it on the next
    // edit; a second call must be a no-op rather than a double teardown.
    hot.update(() => hotMount(container, paragraph('next', torn), hot))
    expect(torn).toEqual(['manual'])
    expect(container.textContent).toBe('next')
  })

  it("matches the shape of Vite's own hot context", () => {
    // A compile-time check with a runtime assertion to keep the test honest:
    // if `HotContext` drifts from `ViteHotContext`, `import.meta.hot` stops
    // being a legal argument and this assignment fails `types:check`.
    const fromVite = createFakeHot() as unknown as ViteHotContext
    const asContext: HotContext = fromVite

    expect(typeof asContext.accept).toBe('function')
    expect(typeof asContext.dispose).toBe('function')
  })
})
