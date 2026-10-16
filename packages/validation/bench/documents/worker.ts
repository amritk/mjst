import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generate } from '@amritk/validation'

import { statsOf } from '../parsers/measure.ts'
import { DOCUMENT_BENCH_CASES } from './cases.ts'
import { largeDocument, smallCorpus } from './corpus.ts'

/**
 * One isolated whole-document measurement, in the worker protocol
 * `scripts/bench-compare.ts` expects: a fresh process per (tree, case), one
 * JSON line on stdout.
 *
 *   usage: bun --conditions development bench/documents/worker.ts <caseName> mjst
 *
 * Throughput is passes over the case's corpus per second. Parity: every document in it
 * is valid OpenAPI 3.0, so `isX` must say so, and `coerceX` must hand each one
 * back untouched.
 */

const [caseName] = process.argv.slice(2)
const benchCase = DOCUMENT_BENCH_CASES.find((candidate) => candidate.name === caseName)
// The exact "unknown bench case" wording is load-bearing: bench-compare reads
// it as "this tree predates the case" and reports n/a instead of failing.
if (!benchCase) throw new Error(`unknown bench case: ${caseName}`)

const schema = JSON.parse(
  readFileSync(new URL('../../../lint/src/rules/openapi/schemas/oas30.json', import.meta.url), 'utf8'),
) as Record<string, unknown>
const files = await generate(schema, 'OpenApi', {
  modes: ['types', 'guard', 'validate', 'coerce'],
  branchErrors: true,
  helpersMode: 'embedded',
})
const dir = mkdtempSync(join(tmpdir(), 'mjst-documents-bench-'))
// `.js` specifiers point at the `.ts` files actually written, so Node's type
// stripping resolves them too (see `validators/validators.ts`).
for (const file of files)
  writeFileSync(join(dir, file.filename), file.content.replace(/(from '\.[^']*)\.js'/g, "$1.ts'"))
const generated = (await import(pathToFileURL(join(dir, 'index.ts')).href)) as {
  isOpenApi: (input: unknown) => boolean
  coerceOpenApi: (input: unknown) => { valid: boolean; value?: unknown }
}
rmSync(dir, { recursive: true, force: true })

const corpus = benchCase.corpus === 'small' ? smallCorpus() : [largeDocument()]
const op =
  benchCase.entry === 'is'
    ? () => {
        let accepted = 0
        for (const document of corpus) if (generated.isOpenApi(document)) accepted++
        return accepted
      }
    : () => {
        let accepted = 0
        for (const document of corpus) if (generated.coerceOpenApi(document).valid) accepted++
        return accepted
      }

const parityOk = corpus.every(
  (document) => generated.isOpenApi(document) && generated.coerceOpenApi(document).value === document,
)

// Each trial repeats the pass until it has run for at least 50 ms, so a pass
// over the small corpus (about a millisecond) is not timed one at a time.
const warmupStart = performance.now()
let warmups = 0
while (warmups < 5 || performance.now() - warmupStart < 300) {
  op()
  warmups++
}
const repeats = Math.max(1, Math.ceil(50 / ((performance.now() - warmupStart) / warmups)))
const samples: number[] = []
for (let i = 0; i < 21; i++) {
  const start = performance.now()
  for (let r = 0; r < repeats; r++) op()
  samples.push((repeats * 1000) / (performance.now() - start))
}

process.stdout.write(JSON.stringify({ parityOk, valid: statsOf(samples) }))
