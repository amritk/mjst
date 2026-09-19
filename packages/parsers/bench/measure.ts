/**
 * Re-export of the shared bench measurement core. The canonical copy lives in
 * generate-parsers/bench/measure.ts; bench code is unpublished dev-tooling, so
 * the cross-package relative import is deliberate and matches what
 * generate-validators/bench does.
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
