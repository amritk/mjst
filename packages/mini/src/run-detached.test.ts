import { describe, expect, it } from 'vitest'

import { runDetached } from './run-detached'
import { effect, effectScope, signal } from './signals'

describe('run-detached', () => {
  it('returns whatever the build produced', () => {
    expect(runDetached(() => 'built')).toBe('built')
  })

  it('keeps a scope built inside an effect alive across that effect re-running', () => {
    // The whole point. Built normally, the scope below would be disposed the
    // moment `trigger` fires; detached, it keeps reacting until someone disposes
    // it on purpose.
    const trigger = signal(0)
    const inner = signal('a')
    const seen: string[] = []
    effect(() => {
      trigger()
      runDetached(() =>
        effectScope(() => {
          effect(() => {
            seen.push(inner())
          })
        }),
      )
    })
    seen.length = 0
    trigger(1)
    // Two scopes are now live — the original one plus the one this run built —
    // so a single write reaches both.
    seen.length = 0
    inner('b')
    expect(seen).toEqual(['b', 'b'])
  })

  it('restores the previous owner even when the build throws', () => {
    // The `finally` matters: leaking `undefined` as the active subscriber would
    // quietly detach everything the caller created after the failure.
    const inner = signal('a')
    const seen: string[] = []
    const dispose = effectScope(() => {
      expect(() =>
        runDetached(() => {
          throw new Error('boom')
        }),
      ).toThrow('boom')
      effect(() => {
        seen.push(inner())
      })
    })
    // The effect landed in the scope, not outside it, so disposing stops it.
    dispose()
    inner('b')
    expect(seen).toEqual(['a'])
  })
})
