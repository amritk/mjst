import { readFileSync } from 'node:fs'
import { createDocument, createLinter, createRuleset, type IDiagnostic, type LintResolver, lint } from '@amritk/lint'
import { createOpenApiRuleset } from '@amritk/lint/rules/openapi'
import { resolveRefs } from '@amritk/resolve-refs'
import { parse } from '@amritk/yaml'

import { statsOf } from '../../validation/bench/parsers/measure.ts'
import { LINT_BENCH_CASES } from './cases.ts'

/**
 * One isolated lint measurement, in the worker protocol `scripts/bench-compare.ts`
 * expects: a fresh process per (tree, case), one JSON line on stdout.
 *
 *   usage: bun --conditions development bench/worker.ts <caseName> mjst
 *
 * A phase takes tens to hundreds of milliseconds, so each trial is one run
 * rather than the shared harness's thousand-call loop; the statistics are the
 * shared ones. Parity is the one check that holds within a single tree: the
 * findings from parsed data must equal the findings from the text, ranges
 * included.
 */

const [caseName] = process.argv.slice(2)
const benchCase = LINT_BENCH_CASES.find((candidate) => candidate.name === caseName)
// The exact "unknown bench case" wording is load-bearing: bench-compare reads
// it as "this tree predates the case" and reports n/a instead of failing.
if (!benchCase) throw new Error(`unknown bench case: ${caseName}`)

const yaml = readFileSync(new URL('../../../fixtures/openapi/real-world/openai.yaml', import.meta.url), 'utf8')
const text = JSON.stringify(parse(yaml), null, 2)
const data = JSON.parse(text) as unknown

const threeRules = createRuleset({
  rules: {
    'deprecated-without-description': {
      given: `$.components.schemas..[?(@ && @.deprecated === true && !(@.description && @.description.trim() !== ''))]`,
      resolved: false,
      then: { function: 'falsy' },
    },
    'single-value-enum': {
      given: '$.components.schemas..[?(@ && @.enum && @.enum.length === 1)]',
      resolved: false,
      then: { function: 'falsy' },
    },
    'empty-object-schema': {
      given: `$.components.schemas..[?(@ && (@.type === 'object' || @.type[0] === 'object' || @.type[1] === 'object') && @.properties === undefined && @.additionalProperties === undefined && @.patternProperties === undefined && @.allOf === undefined && @.oneOf === undefined && @.anyOf === undefined && @['$ref'] === undefined)]`,
      resolved: false,
      then: { function: 'falsy' },
    },
  },
})
const preset = createOpenApiRuleset()
const resolve: LintResolver = (document) => ({ resolved: resolveRefs(document.data, {}).resolved })
const parsed = createDocument(text, { format: 'json' })

const op = ((): (() => Promise<unknown> | unknown) => {
  switch (benchCase.phase) {
    case 'parse':
      return () => createDocument(text, { format: 'json' })
    case 'rules':
      return () => createLinter(threeRules).run(parsed)
    case 'lint-text':
      return () => lint(text, { ruleset: threeRules })
    case 'lint-data':
      return () => lint({ data, text }, { ruleset: threeRules })
    case 'preset':
      return () => lint(text, { ruleset: preset, resolve })
  }
})()

const same = (a: readonly IDiagnostic[], b: readonly IDiagnostic[]): boolean => JSON.stringify(a) === JSON.stringify(b)
const ruleset = benchCase.phase === 'preset' ? preset : threeRules
const options = benchCase.phase === 'preset' ? { ruleset, resolve } : { ruleset }
const parityOk = same(await lint({ data, text }, options), await lint(text, options))

for (let i = 0; i < 3; i++) await op()
const samples: number[] = []
const trials = benchCase.phase === 'preset' ? 9 : 21
for (let i = 0; i < trials; i++) {
  const start = performance.now()
  await op()
  samples.push(1000 / (performance.now() - start))
}

process.stdout.write(JSON.stringify({ parityOk, valid: statsOf(samples) }))
