/**
 * Re-export of the shared bench measurement core. The canonical copy lives in
 * `./parsers/measure.ts`, next to the parser engine's own bench, and every
 * other bench in the repo reaches for that one rather than keeping a copy.
 */
export {
  fmtOps,
  type MeasureOptions,
  measure,
  NOISY_SPREAD,
  opsCell,
  type Stats,
  statsOf,
} from './parsers/measure.ts'
