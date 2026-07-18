import type { RefineIssue, ValidationFailure } from './types'

/**
 * Normalizes what a `refine` hook returned into the shape the
 * `validation_failed` envelope (and the `validationFailed` error formatter)
 * expects: the first issue's `source` labels the failure (defaulting to
 * `'body'`, where cross-field constraints usually live), and each issue
 * becomes a standard `{ message, path }` validation error.
 *
 * Shared by both engines — the compiled module imports it — so refinement
 * failures are byte-identical whichever engine answered.
 */
export const refinementFailure = (issues: readonly RefineIssue[]): ValidationFailure => ({
  source: issues[0]?.source ?? 'body',
  errors: issues.map((issue) => ({ message: issue.message, path: issue.path ?? '' })),
})
