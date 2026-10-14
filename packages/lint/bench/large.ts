import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createDocument, createLinter, createRuleset, type IDiagnostic, type LintResolver, lint } from '@amritk/lint'
import { createOpenApiRuleset } from '@amritk/lint/rules/openapi'
import { resolveRefs } from '@amritk/resolve-refs'

/**
 * Times `@amritk/lint` on one large OpenAPI document, phase by phase, so a
 * regression in any one of them is visible on its own:
 *
 *   - **JSON.parse** — the floor any parse has to be compared with.
 *   - **createDocument** — the source-mapped parse `lint(text)` does first.
 *   - **rules (pre-parsed)** — three `$.components.schemas..[?(...)]` rules run
 *     through `createLinter(ruleset).run()` on an already-parsed document.
 *   - **hand-written walk** — the same three checks as one iterative walk that
 *     also builds a JSON pointer for every node it visits: the bar the rule
 *     pass is measured against.
 *   - **lint (text)** / **lint (data)** — the three rules end to end, from the
 *     source string and from pre-parsed data.
 *   - **preset** — the recommended OpenAPI ruleset end to end, `$ref`s resolved.
 *
 *   bun --conditions development packages/lint/bench/large.ts <document.json> [--dump <file>] [--only <phases>]
 *
 * Any large public OpenAPI document works; without an argument the bench
 * builds a synthetic one (see `synthesize`) so it runs offline and in CI.
 * Each phase prints a fingerprint of its findings so two runs can be checked
 * for identical output as well as compared for speed.
 */

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const documentPath = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'))
const dumpPath = flag('--dump')
const only = flag('--only')?.split(',')
const budgetMs = Number(flag('--budget') ?? 4000)

/**
 * Builds a large OpenAPI 3.0 document from the vendored real-world fixtures:
 * the OpenAI spec's schemas and paths are repeated under renamed keys until
 * the document passes `targetBytes`. `$ref`s are renamed with them, so the
 * copies resolve to their own copy rather than to the original.
 */
const synthesize = async (targetBytes: number): Promise<string> => {
  const { parse } = await import('@amritk/yaml')
  const url = new URL('../../../fixtures/openapi/real-world/openai.yaml', import.meta.url)
  const base = parse(readFileSync(url, 'utf8')) as {
    paths: Record<string, unknown>
    components: { schemas: Record<string, unknown> } & Record<string, unknown>
  } & Record<string, unknown>
  const baseText = JSON.stringify(base)
  const copies = Math.max(1, Math.ceil(targetBytes / baseText.length))
  const out = { ...base, paths: {} as Record<string, unknown>, components: { ...base.components, schemas: {} } }
  const schemas = out.components.schemas as Record<string, unknown>
  for (let copy = 0; copy < copies; copy++) {
    const suffix = copy === 0 ? '' : `_${copy}`
    const rename = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value), (key, inner) =>
        key === '$ref' && typeof inner === 'string' && inner.startsWith('#/components/schemas/')
          ? `${inner}${suffix}`
          : inner,
      )
    for (const [name, schema] of Object.entries(base.components.schemas)) schemas[`${name}${suffix}`] = rename(schema)
    for (const [path, item] of Object.entries(base.paths)) {
      const renamed = rename(item) as Record<string, { operationId?: string }>
      for (const operation of Object.values(renamed)) {
        if (operation && typeof operation === 'object' && typeof operation.operationId === 'string') {
          operation.operationId += suffix
        }
      }
      out.paths[copy === 0 ? path : `/v${copy}${path}`] = renamed
    }
  }
  return JSON.stringify(out, null, 2)
}

const text = documentPath ? readFileSync(documentPath, 'utf8') : await synthesize(25 * 1024 * 1024)
const data = JSON.parse(text) as { components?: { schemas?: Record<string, unknown> } }

const RULES = {
  'deprecated-without-description': `$.components.schemas..[?(@ && @.deprecated === true && !(@.description && @.description.trim() !== ''))]`,
  'single-value-enum': '$.components.schemas..[?(@ && @.enum && @.enum.length === 1)]',
  'empty-object-schema': `$.components.schemas..[?(@ && (@.type === 'object' || @.type[0] === 'object' || @.type[1] === 'object') && @.properties === undefined && @.additionalProperties === undefined && @.patternProperties === undefined && @.allOf === undefined && @.oneOf === undefined && @.anyOf === undefined && @['$ref'] === undefined)]`,
}

const threeRules = createRuleset({
  rules: Object.fromEntries(
    Object.entries(RULES).map(([name, given]) => [name, { given, resolved: false, then: { function: 'falsy' } }]),
  ),
})

const preset = createOpenApiRuleset()
const resolver: LintResolver = (document) => ({ resolved: resolveRefs(document.data, {}).resolved })

/** The three rules' checks, written by hand: one iterative walk, a pointer string per visited node. */
const handWritten = (root: unknown): { rule: string; pointer: string }[] => {
  const found: { rule: string; pointer: string }[][] = [[], [], []]
  const schemas = (root as typeof data).components?.schemas
  if (schemas === undefined) return []
  type Frame = { value: unknown; pointer: string }
  const stack: Frame[] = [{ value: schemas, pointer: '/components/schemas' }]
  while (stack.length > 0) {
    const { value, pointer } = stack.pop() as Frame
    if (typeof value !== 'object' || value === null) continue
    const keys = Object.keys(value)
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i] as string
      stack.push({
        value: (value as Record<string, unknown>)[key],
        pointer: `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      })
    }
    if (Array.isArray(value)) continue
    const node = value as Record<string, unknown>
    const description = node.description
    if (node.deprecated === true && !(typeof description === 'string' && description.trim() !== '')) {
      ;(found[0] as unknown[]).push({ rule: 'deprecated-without-description', pointer })
    }
    if (Array.isArray(node.enum) && node.enum.length === 1) {
      ;(found[1] as unknown[]).push({ rule: 'single-value-enum', pointer })
    }
    const type = node.type
    const isObject = type === 'object' || (Array.isArray(type) && (type[0] === 'object' || type[1] === 'object'))
    if (
      isObject &&
      node.properties === undefined &&
      node.additionalProperties === undefined &&
      node.patternProperties === undefined &&
      node.allOf === undefined &&
      node.oneOf === undefined &&
      node.anyOf === undefined &&
      node.$ref === undefined
    ) {
      ;(found[2] as unknown[]).push({ rule: 'empty-object-schema', pointer })
    }
  }
  return found.flat()
}

type Timing = { medianMs: number; minMs: number; runs: number }

/** Warms `fn` up, then times it until `budgetMs` is spent (at least five runs) and reports the median. */
const measure = async (fn: () => unknown): Promise<Timing> => {
  await fn()
  await fn()
  const samples: number[] = []
  const deadline = performance.now() + budgetMs
  while (samples.length < 5 || (performance.now() < deadline && samples.length < 200)) {
    const start = performance.now()
    await fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: samples[samples.length >> 1] as number, minMs: samples[0] as number, runs: samples.length }
}

const fingerprint = (diagnostics: readonly IDiagnostic[]): string =>
  createHash('sha256')
    .update(JSON.stringify(diagnostics.map((d) => [d.code, d.path, d.range, d.message, d.severity])))
    .digest('hex')
    .slice(0, 12)

const dumps: Record<string, IDiagnostic[]> = {}

type Phase = { name: string; run: () => unknown; findings?: () => Promise<IDiagnostic[]> | IDiagnostic[] }

const parsedDocument = createDocument(text, { format: 'json' })

const phases: Phase[] = [
  { name: 'JSON.parse', run: () => JSON.parse(text) },
  { name: 'createDocument', run: () => createDocument(text, { format: 'json' }) },
  {
    name: 'rules (pre-parsed)',
    run: () => createLinter(threeRules).run(parsedDocument),
    findings: () => createLinter(threeRules).run(parsedDocument),
  },
  { name: 'hand-written walk', run: () => handWritten(data) },
  {
    name: 'lint (text)',
    run: () => lint(text, { ruleset: threeRules }),
    findings: () => lint(text, { ruleset: threeRules }),
  },
  {
    name: 'lint (data)',
    run: () => lint({ data, text }, { ruleset: threeRules }),
    findings: () => lint({ data, text }, { ruleset: threeRules }),
  },
  {
    name: 'preset (text+resolve)',
    run: () => lint(text, { ruleset: preset, resolve: resolver }),
    findings: () => lint(text, { ruleset: preset, resolve: resolver }),
  },
  {
    name: 'preset (data+resolve)',
    run: () => lint({ data, text }, { ruleset: preset, resolve: resolver }),
    findings: () => lint({ data, text }, { ruleset: preset, resolve: resolver }),
  },
]

console.log(`runtime: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`}`)
console.log(
  `document: ${documentPath ?? 'synthetic'} — ${(Buffer.byteLength(text) / 1024 / 1024).toFixed(1)} MB, ` +
    `${Object.keys(data.components?.schemas ?? {}).length} component schemas\n`,
)
console.log(`  ${'phase'.padEnd(26)}${'median'.padStart(10)}${'min'.padStart(10)}${'runs'.padStart(6)}   findings`)
for (const phase of phases) {
  if (only && !only.includes(phase.name)) continue
  const timing = await measure(phase.run)
  let findings = ''
  if (phase.findings) {
    const diagnostics = await phase.findings()
    dumps[phase.name] = diagnostics
    findings = `${diagnostics.length} (${fingerprint(diagnostics)})`
  } else if (phase.name === 'hand-written walk') {
    findings = String(handWritten(data).length)
  }
  console.log(
    `  ${phase.name.padEnd(26)}${`${timing.medianMs.toFixed(1)} ms`.padStart(10)}${`${timing.minMs.toFixed(1)} ms`.padStart(10)}${String(timing.runs).padStart(6)}   ${findings}`,
  )
}

if (dumpPath) writeFileSync(dumpPath, JSON.stringify(dumps))
