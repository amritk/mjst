/**
 * Times the single-pass repair walk on a bundled OpenAPI document of about
 * 24 MB, the case it was built for.
 *
 *   bun --conditions development scripts/bench-repair-walk.ts [targetMegabytes]
 *
 * The document is the vendored OpenAI description with its `paths` copied under
 * new prefixes until it reaches the target size, so it keeps a real document's
 * shape and its tens of thousands of `$ref`s. The schema is the one the walk's
 * tests use (`openapi-coercer-schema.test-utils.ts`).
 *
 * Three numbers come out: the first repair (which fixes whatever the schema is
 * stricter about than the document), a repair of the now-valid document — the
 * steady state of a coercer that mostly sees good input — and a repair of the
 * valid document with a few hundred faults injected at depth.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildValidatorSchema } from '../packages/validation/src/validators/generators/build-schema'
import { OPENAPI_COERCER_SCHEMA } from '../packages/validation/src/validators/generators/openapi-coercer-schema.test-utils'
import { parse as parseYaml } from '../packages/yaml/src/index'

type Repair = (
  input: unknown,
  options?: Record<string, unknown>,
) => {
  valid: boolean
  value: unknown
  repairs: unknown[]
  errors?: unknown[]
}

const targetBytes = Number(process.argv[2] ?? 24) * 1024 * 1024

const files = await buildValidatorSchema(
  OPENAPI_COERCER_SCHEMA,
  'OpenApi',
  '',
  undefined,
  'count-keys',
  undefined,
  false,
  false,
  true,
  'ts',
)
const outDir = mkdtempSync(join(tmpdir(), 'mjst-bench-repair-'))
mkdirSync(outDir, { recursive: true })
for (const file of files) writeFileSync(join(outDir, file.filename), file.content)
const { repairOpenApi } = (await import(join(outDir, 'index.ts'))) as { repairOpenApi: Repair }

const source = readFileSync(new URL('../fixtures/openapi/real-world/openai.yaml', import.meta.url), 'utf8')
const base = parseYaml(source) as Record<string, unknown>
const basePaths = base['paths'] as Record<string, unknown>

const build = (): Record<string, unknown> => {
  const doc = structuredClone(base)
  const paths: Record<string, unknown> = {}
  let copy = 0
  let size = JSON.stringify(doc).length
  const perCopy = JSON.stringify(basePaths).length
  while (size < targetBytes) {
    for (const [key, value] of Object.entries(basePaths)) paths[`/copy${copy}${key}`] = structuredClone(value)
    copy++
    size += perCopy
  }
  doc['paths'] = paths
  return doc
}

const time = <T>(label: string, run: () => T): T => {
  const start = performance.now()
  const out = run()
  console.log(`${label.padEnd(44)} ${(performance.now() - start).toFixed(1).padStart(8)} ms`)
  return out
}

const doc = build()
const text = JSON.stringify(doc)
console.log(`document: ${(text.length / 1024 / 1024).toFixed(1)} MB, ${text.split('"$ref"').length - 1} $refs`)

const first = time('first repair (in place)', () => repairOpenApi(doc, { inPlace: true, coerce: false }))
console.log(`  valid: ${first.valid}, repairs: ${first.repairs.length}, errors: ${first.errors?.length ?? 0}`)

for (let i = 0; i < 3; i++) {
  const again = time(`valid document, run ${i + 1}`, () =>
    repairOpenApi(doc, { inPlace: true, coerce: false, skipRefs: ['#/components/'] }),
  )
  if (!again.valid || again.repairs.length > 0) throw new Error('a repaired document did not stay valid')
}
time('valid document, following every $ref', () => repairOpenApi(doc, { inPlace: true, coerce: false }))
time('valid document, copy-on-write', () => repairOpenApi(doc, { coerce: false, skipRefs: ['#/components/'] }))

// Faults at depth: wrong types, a missing required key, a bad discriminator.
const faulty = structuredClone(doc) as { paths: Record<string, Record<string, Record<string, unknown>>> }
let injected = 0
for (const item of Object.values(faulty.paths)) {
  for (const operation of Object.values(item)) {
    if (typeof operation !== 'object' || operation === null || injected >= 300) continue
    const responses = operation['responses'] as Record<string, Record<string, unknown>> | undefined
    if (responses === undefined) continue
    for (const response of Object.values(responses)) {
      if ('$ref' in response) continue
      if (injected % 3 === 0) response['description'] = 42
      else if (injected % 3 === 1) delete response['description']
      else response['content'] = 'not a map'
      injected++
      break
    }
  }
}
const faultyRun = time(`${injected} faults (in place)`, () =>
  repairOpenApi(faulty, { inPlace: true, coerce: false, skipRefs: ['#/components/'] }),
)
console.log(`  valid: ${faultyRun.valid}, repairs: ${faultyRun.repairs.length}`)

rmSync(outDir, { recursive: true, force: true })
