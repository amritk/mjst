import { describe, expect, it } from 'vitest'

import { createRunScope, RUN_SCOPE, runCache } from './run-scope'
import type { IFunctionContext } from './types'

const contextIn = (scope: ReturnType<typeof createRunScope>): IFunctionContext =>
  ({ [RUN_SCOPE]: scope }) as unknown as IFunctionContext

describe('run-scope', () => {
  it('hands every call in one run the same cache, and the next run a new one', () => {
    const owner = {}
    const node = {}
    const first = createRunScope()
    runCache<string>(contextIn(first), owner).set(node, 'cached')
    expect(runCache<string>(contextIn(first), owner).get(node)).toBe('cached')
    expect(runCache<string>(contextIn(createRunScope()), owner).get(node)).toBeUndefined()
  })

  it('keeps each owner apart within a run', () => {
    const scope = createRunScope()
    const node = {}
    runCache<string>(contextIn(scope), {}).set(node, 'one')
    expect(runCache<string>(contextIn(scope), {}).get(node)).toBeUndefined()
  })

  it('caches nothing for a context the runner did not build', () => {
    const owner = {}
    const node = {}
    const context = {} as IFunctionContext
    runCache<string>(context, owner).set(node, 'cached')
    expect(runCache<string>(context, owner).get(node)).toBeUndefined()
  })
})
