/**
 * `@amritk/mini/query` — a thin adapter that bridges `@tanstack/query-core`
 * observers to mini signals, so the dashboards get caching, deduplication,
 * retries, and invalidation without mini hand-rolling a resource primitive.
 *
 * It is its own module graph and depends on `@tanstack/query-core` as an
 * optional peer: the widget's `.` bundle is untouched, and only an app that
 * imports `/query` needs query-core installed.
 */
export type { QueryResult } from './create-query'
export { createQuery } from './create-query'
