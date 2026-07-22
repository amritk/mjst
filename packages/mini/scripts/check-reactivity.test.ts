import { describe, expect, test } from 'vitest'

import { scanSource } from './check-reactivity'

describe('check-reactivity', () => {
  test('flags a signal called directly in a JSX attribute', () => {
    const source = `
      const streaming = signal(false)
      const view = <button disabled={streaming()}>Send</button>
    `
    const findings = scanSource('x.tsx', source)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ target: 'disabled', signal: 'streaming' })
  })

  test('flags a signal called directly as a JSX child', () => {
    const source = `
      const count = signal(0)
      const view = <span>{count()}</span>
    `
    const findings = scanSource('x.tsx', source)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.target).toBe('children')
  })

  test('accepts the reactive forms: bare signal and thunk', () => {
    const source = `
      const streaming = signal(false)
      const count = signal(0)
      const a = <button disabled={streaming}>Send</button>
      const b = <span>{() => count() * 2}</span>
      const c = <button disabled={() => streaming()}>Send</button>
    `
    expect(scanSource('x.tsx', source)).toHaveLength(0)
  })

  test('does not flag a signal called inside an event handler', () => {
    const source = `
      const count = signal(0)
      const view = <button onClick={() => count(count() + 1)}>+</button>
    `
    expect(scanSource('x.tsx', source)).toHaveLength(0)
  })

  test('recognises computed and Signal-typed parameters', () => {
    const source = `
      const doubled = computed(() => 1)
      const Row = (props: { active: Signal<boolean> }) => <li class={doubled()} />
    `
    const findings = scanSource('x.tsx', source)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.signal).toBe('doubled')
  })

  test('honours the // mini-static-ok opt-out', () => {
    const source = `
      const count = signal(0)
      const view = <span data-initial={count()}>x</span> // mini-static-ok
    `
    expect(scanSource('x.tsx', source)).toHaveLength(0)
  })

  test('ignores files with no signals', () => {
    expect(scanSource('x.tsx', '<button disabled={foo()}>x</button>')).toHaveLength(0)
  })
})
