/**
 * Re-export of the shared bench measurement core. The canonical copy lives in
 * `../parsers/measure.ts` (both benches used to carry identical copies that had
 * to be kept in sync by hand).
 */
export {
  fmtOps,
  type MeasureOptions,
  measure,
  NOISY_SPREAD,
  opsCell,
  type Stats,
  statsOf,
} from '../parsers/measure.ts'
