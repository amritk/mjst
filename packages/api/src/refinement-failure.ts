import type { RefineIssue, ValidationFailure } from './types'

/**
 * Normalizes what a `refine` hook returned into the shape the
 * `validation_failed` envelope (and the `validationFailed` error formatter)
 * expects: the first issue's `source` labels the failure (defaulting to
 * `'body'`, where cross-field constraints usually live), and each issue becomes
 * a standard validation error.
 *
 * Its `keyword` is `refine` rather than a JSON Schema keyword, because that is
 * the truth: a refinement failure comes from a hook the route declared, not from
 * the schema. Anything switching on `keyword` to render or translate an error
 * therefore sees these as their own kind rather than mistaking one for a
 * `required` or a `pattern` it can explain.
 *
 * Shared by both engines — the compiled module imports it — so refinement
 * failures are byte-identical whichever engine answered.
 */
export const refinementFailure = (issues: readonly RefineIssue[]): ValidationFailure => ({
  source: issues[0]?.source ?? 'body',
  errors: issues.map((issue) => ({
    message: issue.message,
    path: issue.path ?? '',
    keyword: 'refine',
    params: {},
  })),
})
