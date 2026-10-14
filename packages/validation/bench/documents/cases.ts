/**
 * Whole-document cases for the generated validators: the OpenAPI 3.0 schema
 * (the one `@amritk/lint` vendors, 42 definitions, generated to ~45 files)
 * checking real OpenAPI 3.0 documents. These are the workloads per-field
 * micro-cases cannot show — per-call overhead across many small documents,
 * and recursion, unions and `$ref` hops across one large one — timed through
 * `isX` and through `coerceX` with `--branch-errors`.
 *
 * The names are the worker's protocol: a tree that lacks one reports `n/a`.
 */
export type DocumentBenchCase = {
  readonly name: string
  readonly corpus: 'small' | 'large'
  readonly entry: 'is' | 'coerce'
}

export const DOCUMENT_BENCH_CASES: readonly DocumentBenchCase[] = [
  { name: 'OpenAPI 3.0, 90 small documents (coerceX)', corpus: 'small', entry: 'coerce' },
  { name: 'OpenAPI 3.0, one 4 MB document (isX)', corpus: 'large', entry: 'is' },
  { name: 'OpenAPI 3.0, one 4 MB document (coerceX)', corpus: 'large', entry: 'coerce' },
]
