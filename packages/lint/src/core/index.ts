export { createDocument, type Document, type IDocumentOptions } from './document'
export { detectFormats, type Format } from './formats'
export { globToRegExp, matchesGlob } from './glob'
export { type CompiledPath, compileQuery, type IQueryMatch, query, queryCompiled, queryMany } from './jsonpath'
export {
  type LintOptions,
  type LintResolver,
  type LintResolverResult,
  type LintResult,
  lint,
  lintWithResult,
} from './lint'
export {
  type LintPlugin,
  type LintPluginContext,
  type LintPluginResult,
  type PluginRunResult,
  runPlugins,
} from './plugin'
export {
  pointerToPath,
  resolveSourceOrigin,
  resolveSourceOriginFromMap,
  resolveSourcePath,
} from './pointers'
export {
  type AliasDefinition,
  createRuleset,
  type ExtendModifier,
  type ExtendResolver,
  type ResolvedExtend,
  type Ruleset,
  type RulesetOptions,
} from './ruleset'
export { createLinter, type IRunOptions, type Linter } from './runner'
// The core type surface lives in `./types` and is published on its own
// `@amritk/lint/types` subpath — it is deliberately not re-exported through this
// barrel. Modules that need those types import them from `./types` directly.
export { type IRulesetProblem, validateRuleset } from './validate-ruleset'
