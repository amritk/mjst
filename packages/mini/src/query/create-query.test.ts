import { QueryClient } from '@tanstack/query-core'
import { effectScope } from 'alien-signals'
import { describe, expect, it, vi } from 'vitest'

import { signal } from '../signals'
import { createQuery } from './create-query'

/** Reads how many live observers a query has, to prove teardown detaches them. */
const observerCount = (client: QueryClient, key: readonly unknown[]): number =>
  client.getQueryCache().find({ queryKey: key })?.getObserversCount() ?? 0

describe('create-query', () => {
  it('reads already-cached data as an immediate success', async () => {
    const client = new QueryClient()
    await client.prefetchQuery({ queryKey: ['cached'], queryFn: async () => 'hello' })
    let query!: ReturnType<typeof createQuery<string>>
    effectScope(() => {
      query = createQuery<string>(client, { queryKey: ['cached'], queryFn: async () => 'hello' })
    })
    expect(query.isSuccess()).toBe(true)
    expect(query.data()).toBe('hello')
  })

  it('transitions from pending to success as the query resolves', async () => {
    const client = new QueryClient()
    let query!: ReturnType<typeof createQuery<string>>
    effectScope(() => {
      query = createQuery<string>(client, { queryKey: ['fresh'], queryFn: async () => 'value' })
    })
    expect(query.isPending()).toBe(true)
    await vi.waitFor(() => expect(query.isSuccess()).toBe(true))
    expect(query.data()).toBe('value')
  })

  it('surfaces a query error through the error signal', async () => {
    const client = new QueryClient()
    let query!: ReturnType<typeof createQuery<string>>
    effectScope(() => {
      query = createQuery<string>(client, {
        queryKey: ['boom'],
        queryFn: async () => {
          throw new Error('boom')
        },
        retry: false,
      })
    })
    await vi.waitFor(() => expect(query.isError()).toBe(true))
    expect((query.error() as Error).message).toBe('boom')
  })

  it('refetches under a new key when the options getter changes', async () => {
    const client = new QueryClient()
    await client.prefetchQuery({ queryKey: ['user', 1], queryFn: async () => 'one' })
    await client.prefetchQuery({ queryKey: ['user', 2], queryFn: async () => 'two' })
    const id = signal(1)
    let query!: ReturnType<typeof createQuery<string>>
    effectScope(() => {
      // Options as a getter: the query key depends on a signal.
      query = createQuery<string>(client, () => ({ queryKey: ['user', id()], queryFn: async () => 'x' }))
    })
    await vi.waitFor(() => expect(query.data()).toBe('one'))
    // Flipping the signal pushes new options into the observer, which refetches.
    id(2)
    await vi.waitFor(() => expect(query.data()).toBe('two'))
  })

  it('detaches the observer when its scope is disposed', async () => {
    const client = new QueryClient()
    const dispose = effectScope(() => {
      createQuery<string>(client, { queryKey: ['scoped'], queryFn: async () => 'x' })
    })
    await vi.waitFor(() => expect(observerCount(client, ['scoped'])).toBe(1))
    dispose()
    // onCleanup ran the observer's unsubscribe, so nothing is left listening.
    expect(observerCount(client, ['scoped'])).toBe(0)
  })
})
