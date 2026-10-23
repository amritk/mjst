/**
 * Phase and per-rule timings for `@amritk/lint`'s OpenAPI preset, shaped to line up with bane's
 * `packages/cli/lint-bench/run.ts` (scalar diagnose) over the same documents. Not part of the
 * package: run with `bun --conditions development ./bench/vs-bane.ts <spec>...`.
 *
 *   - parse     — `createDocument` (parse with source maps)
 *   - resolve   — `resolveRefs` over the parsed data
 *   - rules     — the preset's rule pass over parsed + resolved data
 *   - lint      — the whole `lint()` call: parse → resolve → rules
 *   - per rule  — each rule run alone over the same data. Rules normally share one query plan, so
 *                 these sum to more than `rules`; they rank rules, they do not partition the pass.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolveRefs } from '@amritk/resolve-refs'

import { createDocument } from '../src/core/document'
import { lint } from '../src/core/lint'
import type { Ruleset } from '../src/core/ruleset'
import { createLinter } from '../src/core/runner'
import { createOpenApiRuleset } from '../src/rules/openapi'

type Timing = { medianMs: number; minMs: number; iterations: number }

/** Warms up once, then times `fn` until `budgetMs` is spent (at least `minIterations`, at most `maxIterations`). */
const measure = async (fn: () => unknown, budgetMs = 3000, minIterations = 3, maxIterations = 50): Promise<Timing> => {
  await fn()
  const samples: number[] = []
  const start = performance.now()
  while (samples.length < maxIterations && (samples.length < minIterations || performance.now() - start < budgetMs)) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: samples[Math.floor(samples.length / 2)] ?? 0, minMs: samples[0] ?? 0, iterations: samples.length }
}

/** The same ruleset narrowed to one rule, so that rule's cost can be read on its own. */
const onlyRule = (ruleset: Ruleset, rule: Ruleset['rules'][number]): Ruleset => ({
  ...ruleset,
  rulesForSource: () => [rule],
})

const specs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const jsonOut = process.argv.find((arg) => arg.startsWith('--json='))?.slice('--json='.length)
const ruleset = createOpenApiRuleset()
const resolver = (document: { data: unknown }) => ({ resolved: resolveRefs(document.data, {}).resolved })
const results: unknown[] = []

for (const spec of specs) {
  const input = readFileSync(spec, 'utf8')
  const bytes = Buffer.byteLength(input, 'utf8')
  console.log(`\n### ${spec} (${(bytes / 1024).toFixed(0)} KB)`)

  const parse = await measure(() => createDocument(input, { source: spec }))
  const document = createDocument(input, { source: spec })
  const resolve = await measure(() => resolveRefs(document.data, {}))
  const resolved = resolveRefs(document.data, {}).resolved
  const linter = createLinter(ruleset)
  const rules = await measure(() => linter.run(document, { resolved }))
  const full = await measure(() => lint(input, { ruleset, resolve: resolver, source: spec }))
  const findings = await lint(input, { ruleset, resolve: resolver, source: spec })

  const perRule: { id: string; ms: number }[] = []
  for (const rule of ruleset.rulesForSource(spec)) {
    if (!rule.enabled) continue
    const single = createLinter(onlyRule(ruleset, rule))
    const timing = await measure(() => single.run(document, { resolved }), 300, 2, 20)
    perRule.push({ id: rule.name, ms: timing.medianMs })
  }
  perRule.sort((a, b) => b.ms - a.ms)

  const byCode = new Map<string, number>()
  for (const finding of findings) byCode.set(String(finding.code), (byCode.get(String(finding.code)) ?? 0) + 1)

  console.log(`parse          ${parse.medianMs.toFixed(1)} ms`)
  console.log(`resolve        ${resolve.medianMs.toFixed(1)} ms`)
  console.log(`rules          ${rules.medianMs.toFixed(1)} ms`)
  console.log(`lint (all)     ${full.medianMs.toFixed(1)} ms`)
  console.log(`findings       ${findings.length}`)
  console.log(`enabled rules  ${perRule.length}; slowest alone:`)
  for (const rule of perRule.slice(0, 8)) console.log(`  ${rule.ms.toFixed(2).padStart(9)} ms  ${rule.id}`)

  results.push({
    spec,
    bytes,
    parseMs: parse.medianMs,
    resolveMs: resolve.medianMs,
    rulesMs: rules.medianMs,
    lintMs: full.medianMs,
    findings: findings.length,
    findingsByCode: Object.fromEntries(byCode),
    perRule,
  })
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2))
