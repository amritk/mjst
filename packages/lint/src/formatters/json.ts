import type { Formatter } from './common'

/** Machine-readable JSON array of the diagnostics. */
export const json: Formatter = (results) =>
  JSON.stringify(
    results.map((r) => ({
      code: r.code,
      message: r.message,
      path: r.path,
      severity: r.severity,
      source: r.source,
      range: r.range,
    })),
    null,
    2,
  )
