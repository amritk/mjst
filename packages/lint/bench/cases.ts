/**
 * The cases `scripts/bench-compare.ts` times for `@amritk/lint`, one per phase
 * of a lint run, so a regression in any one of them shows on its own row
 * rather than diluted into an end-to-end number. Every case runs over the same
 * document: the vendored OpenAI spec, re-serialized as JSON (~4 MB), which is
 * the largest real-world document in the repo and exercises the JSON path the
 * large-document work targets.
 *
 * The names are the worker's protocol: a tree that lacks one reports `n/a`.
 */
export type LintBenchCase = {
  readonly name: string
  readonly phase: 'parse' | 'rules' | 'lint-text' | 'lint-data' | 'preset'
}

export const LINT_BENCH_CASES: readonly LintBenchCase[] = [
  { name: 'parse JSON (openai)', phase: 'parse' },
  { name: 'rules on parsed data, 3 schema filters (openai)', phase: 'rules' },
  { name: 'lint text, 3 schema filters (openai)', phase: 'lint-text' },
  { name: 'lint parsed data + text, 3 schema filters (openai)', phase: 'lint-data' },
  { name: 'OpenAPI preset, $refs resolved (openai)', phase: 'preset' },
]
