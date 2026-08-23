import type { LintPlugin } from '../core'
import { type ApplyFixesOptions, applyFixes } from './apply'
import type { AppliedFix, FixerRegistry } from './types'

/** The name the fix plugin registers under (its `data` is surfaced here). */
export const FIX_PLUGIN_NAME = 'fix'

/** Structured output the fix plugin returns under {@link FIX_PLUGIN_NAME}. */
export type FixPluginData = {
  applied: AppliedFix[]
}

/**
 * Builds the auto-fix {@link LintPlugin} from a {@link FixerRegistry}. As a
 * post-lint plugin it reads the run's findings and the raw document text, applies
 * the fixers' edits, and returns the rewritten text as `output` plus the list of
 * repaired findings as `data`. The core engine stays unaware of fixing — remove
 * this plugin (and the `../fix` dependency) and Linter lints exactly as
 * before.
 */
export const createFixPlugin = (fixers: FixerRegistry, options: ApplyFixesOptions = {}): LintPlugin => ({
  name: FIX_PLUGIN_NAME,
  afterLint: (diagnostics, context) => {
    // Only this document's findings. A finding carrying another `source` came
    // from a file inlined by the resolver, and its path is relative to *that*
    // document — applying a fixer here would edit whatever happens to sit at the
    // same path in this one.
    const own = diagnostics.filter((diagnostic) => diagnostic.source === context.source)
    const result = applyFixes(context.input, context.format, context.document.data, own, fixers, options)
    if (!result.changed) return undefined
    const data: FixPluginData = { applied: result.applied }
    return { output: result.output, data }
  },
})
