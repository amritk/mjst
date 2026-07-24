import {
  type DefaultError,
  type QueryClient,
  type QueryKey,
  QueryObserver,
  type QueryObserverOptions,
  type QueryObserverResult,
  type RefetchOptions,
} from '@tanstack/query-core'

import { onCleanup } from '../on-cleanup'
import type { ReadonlySignal } from '../signals'
import { computed, effect, signal } from '../signals'

/**
 * A query exposed as mini signals. `result` is the full TanStack Query result;
 * the rest are `computed` views onto its most-used fields so a binding can read
 * exactly what it needs (`data`, `isPending`, …) and re-run only when that
 * field changes.
 */
export type QueryResult<TData, TError> = {
  /** The complete reactive query result — everything below is derived from it. */
  result: ReadonlySignal<QueryObserverResult<TData, TError>>
  /** The resolved data, or `undefined` before the first success. */
  data: ReadonlySignal<TData | undefined>
  /** The error, or `null` when there is none. */
  error: ReadonlySignal<TError | null>
  /** `'pending' | 'error' | 'success'`. */
  status: ReadonlySignal<QueryObserverResult<TData, TError>['status']>
  /** No cached data yet. */
  isPending: ReadonlySignal<boolean>
  /** First load in flight (pending and fetching). */
  isLoading: ReadonlySignal<boolean>
  /** Any fetch in flight, including background refetches. */
  isFetching: ReadonlySignal<boolean>
  /** Data is available. */
  isSuccess: ReadonlySignal<boolean>
  /** The query errored. */
  isError: ReadonlySignal<boolean>
  /** Imperatively refetch; resolves with the settled result. Options are forwarded to query-core. */
  refetch: (options?: RefetchOptions) => Promise<QueryObserverResult<TData, TError>>
}

/**
 * Bridges a `@tanstack/query-core` `QueryObserver` to mini signals — the
 * sanctioned data layer for the dashboards. Rather than hand-rolling a resource
 * primitive, this mirrors how `solid-query` wraps query-core: caching,
 * deduplication, retries, and invalidation all come from TanStack Query, and
 * this file only forwards the observer's results into signals.
 *
 * The observer is subscribed immediately and unsubscribed through `onCleanup`,
 * so call `createQuery` inside a component (or any `effectScope`) — the
 * subscription then dies with the surrounding scope, exactly like a `bind*`
 * call. `@tanstack/query-core` is an optional peer dependency: install it only
 * if you use `/query`.
 */
export const createQuery = <
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  client: QueryClient,
  options:
    | QueryObserverOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>
    | (() => QueryObserverOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>),
): QueryResult<TData, TError> => {
  // Options may be a getter so the query key (and everything else) can depend on
  // signals — `() => ({ queryKey: ['user', id()], ... })`. A plain object is
  // wrapped in a constant getter, so one code path serves both.
  const getOptions = typeof options === 'function' ? options : () => options

  const defaulted = client.defaultQueryOptions(getOptions())
  const observer = new QueryObserver<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>(client, defaulted)

  const result = signal(observer.getOptimisticResult(defaulted))

  // Track the options getter and push every change into the observer, so a
  // reactive query key refetches under the new key. The first effect run only
  // records dependencies — the observer already holds these options — while
  // later runs (a tracked signal changed) call `setOptions` and re-seed the
  // optimistic result. Without that re-seed, `data`/`isPending` would keep
  // reporting the previous key until query-core's async subscription fires.
  let first = true
  onCleanup(
    effect(() => {
      const next = client.defaultQueryOptions(getOptions())
      if (first) {
        first = false
        return
      }
      observer.setOptions(next)
      result(observer.getOptimisticResult(next))
    }),
  )

  // query-core pushes a fresh result object on every state change; each one
  // replaces the signal, and the derived views below narrow it to a field.
  onCleanup(observer.subscribe((next) => result(next)))

  return {
    result,
    data: computed(() => result().data),
    error: computed(() => result().error),
    status: computed(() => result().status),
    isPending: computed(() => result().isPending),
    isLoading: computed(() => result().isLoading),
    isFetching: computed(() => result().isFetching),
    isSuccess: computed(() => result().isSuccess),
    isError: computed(() => result().isError),
    refetch: (refetchOptions?: RefetchOptions) => observer.refetch(refetchOptions),
  }
}
