/**
 * Re-export of the shared bench measurement core. The canonical copy lives in
 * generate-parsers/bench/measure.ts (both benches used to carry identical
 * copies that had to be kept in sync by hand); bench code is unpublished
 * dev-tooling, so the cross-package relative import is deliberate.
 */
export {
  fmtOps,
  type MeasureOptions,
  measure,
  NOISY_SPREAD,
  opsCell,
  type Stats,
  statsOf,
} from '../../generate-parsers/bench/measure.ts'
