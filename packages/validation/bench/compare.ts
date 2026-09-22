import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { MODE_CASES } from './cases.ts'
import type { WorkerResult } from './compare-worker.ts'
import { generateWay, WAY_IDS, WAY_LABELS, type WayId, wholeMatrix } from './engines.ts'
import { opsCell } from './measure.ts'

/**
 * `@amritk/validation` against the packages it composes, mode by mode.
 *
 * The question this answers is narrow and worth stating plainly: a facade over
 * two generators should cost *nothing at runtime*, because it emits their code
 * rather than its own. So the bar here is parity, not a speedup — a mode that
 * came out meaningfully faster would mean the new package is emitting something
 * different, which is a bug, not a win.
 *
 * Where it is allowed to differ is the cold side: what it costs to generate, and
 * what a consumer then ships. The `whole matrix` row at the end is the case the
 * package exists for — before, reaching every mode meant running both generators
 * and shipping two trees, including two declarations of the same type.
 *
 * Same methodology as the other benches: every (mode, way) pair is timed in its
 * own freshly spawned process, each worker takes many timed trials and reports
 * the median plus the spread, and `~` flags a sample that wobbled past 10%.
 */

const WORKER = fileURLToPath(new URL('./compare-worker.ts', import.meta.url))
const BENCH_DIR = fileURLToPath(new URL('.', import.meta.url))

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

const IS_BUN = typeof Bun !== 'undefined'

const runWorker = (mode: string, way: WayId): WorkerResult => {
  const flags = IS_BUN ? ['--conditions', 'development'] : []
  const stdout = execFileSync(process.execPath, [...flags, WORKER, mode, way], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    cwd: BENCH_DIR,
  })
  return JSON.parse(stdout) as WorkerResult
}

/** Times one cold codegen, averaged over runs. */
const codegenMs = async (run: () => Promise<unknown>, iterations = 30): Promise<number> => {
  for (let i = 0; i < 5; i++) await run()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await run()
  return (performance.now() - start) / iterations
}

/** Total emitted bytes, and how many times the root type is declared. */
const weigh = (files: readonly { filename: string; content: string }[]): { bytes: number; types: number } => ({
  bytes: files.reduce((total, file) => total + file.content.length, 0),
  types: files.reduce((total, file) => total + (file.content.match(/^export type Order\b/gm)?.length ?? 0), 0),
})

/** A ratio read out as a percentage difference, with a verdict on whether it matters. */
const delta = (after: number, before: number): string => {
  const ratio = after / before
  const percent = (ratio - 1) * 100
  const sign = percent >= 0 ? '+' : ''
  return `${sign}${percent.toFixed(1)}%`
}

const run = async (): Promise<void> => {
  console.log('\n=== @amritk/validation vs reaching each mode directly ===\n')
  console.log(`Node/Bun: ${IS_BUN ? `Bun ${Bun.version}` : process.version}`)
  console.log('Each (mode, way) pair is timed in an isolated process; ±n% is the coefficient of variation,')
  console.log('and ~ flags a sample whose CV exceeded 10%.')
  console.log('The bar is parity: the new package emits the old packages’ code, so a real gap either way')
  console.log('means something is being emitted differently.\n')

  console.log(`  ${pad('mode', 22)}${pad('way', 26)}${padStart('good ops/s', 20)}${padStart('bad ops/s', 20)}`)

  for (const modeCase of MODE_CASES) {
    const results = new Map<WayId, WorkerResult>()
    for (const way of WAY_IDS) results.set(way, runWorker(modeCase.id, way))

    for (const way of WAY_IDS) {
      const r = results.get(way)
      if (!r) continue
      const label = way === 'before' ? modeCase.label : ''
      console.log(
        `  ${pad(label, 22)}${pad(WAY_LABELS[way], 26)}` +
          `${padStart(opsCell(r.good.median, r.good.spread), 20)}${padStart(opsCell(r.bad.median, r.bad.spread), 20)}`,
      )
    }

    const b = results.get('before')
    const a = results.get('after')
    if (b && a) {
      console.log(
        `  ${pad('', 22)}${pad('→ after vs before', 26)}` +
          `${padStart(delta(a.good.median, b.good.median), 20)}${padStart(delta(a.bad.median, b.bad.median), 20)}`,
      )
    }
    console.log('')
  }

  console.log('\n  cold cost per mode (codegen, emitted bytes, declarations of the root type):\n')
  console.log(
    `  ${pad('mode', 22)}${pad('way', 26)}${padStart('codegen', 12)}${padStart('bytes', 12)}${padStart('types', 8)}`,
  )
  for (const modeCase of MODE_CASES) {
    for (const way of WAY_IDS) {
      const { bytes, types } = weigh(await generateWay(way, modeCase.id))
      const ms = await codegenMs(() => generateWay(way, modeCase.id))
      console.log(
        `  ${pad(way === 'before' ? modeCase.label : '', 22)}${pad(WAY_LABELS[way], 26)}` +
          `${padStart(`${ms.toFixed(2)} ms`, 12)}${padStart(`${(bytes / 1024).toFixed(1)} KiB`, 12)}${padStart(String(types), 8)}`,
      )
    }
  }

  console.log('\n  the whole matrix — every mode at once, which is what the package is for:\n')
  console.log(
    `  ${pad('way', 26)}${padStart('codegen', 12)}${padStart('bytes', 12)}${padStart('files', 8)}${padStart('types', 8)}`,
  )
  const matrix = new Map<WayId, { ms: number; bytes: number; files: number; types: number }>()
  for (const way of WAY_IDS) {
    const files = await wholeMatrix(way)
    const { bytes, types } = weigh(files)
    const ms = await codegenMs(() => wholeMatrix(way))
    matrix.set(way, { ms, bytes, files: files.length, types })
    console.log(
      `  ${pad(WAY_LABELS[way], 26)}${padStart(`${ms.toFixed(2)} ms`, 12)}` +
        `${padStart(`${(bytes / 1024).toFixed(1)} KiB`, 12)}${padStart(String(files.length), 8)}${padStart(String(types), 8)}`,
    )
  }
  const mb = matrix.get('before')
  const ma = matrix.get('after')
  if (mb && ma) {
    console.log(
      `  ${pad('→ after vs before', 26)}${padStart(delta(ma.ms, mb.ms), 12)}` +
        `${padStart(delta(ma.bytes, mb.bytes), 12)}${padStart(delta(ma.files, mb.files), 8)}${padStart(`${mb.types}→${ma.types}`, 8)}`,
    )
  }
  console.log('')
}

await run()
