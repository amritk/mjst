import { isDependencyDeclared } from './is-dependency-declared'

/**
 * Detects whether generated parsers should import `@amritk/helpers` from the
 * package (`'package'`) or ship the helper sources alongside them (`'embedded'`).
 *
 * We select `'package'` only when `@amritk/helpers` is a *declared* dependency
 * of the target project's nearest `package.json` above `outputDir` — see
 * {@link isDependencyDeclared} for why merely being resolvable is not enough.
 * Everything else falls back to the self-contained `'embedded'` mode.
 */
export const detectHelpersMode = (outputDir: string): 'package' | 'embedded' =>
  isDependencyDeclared(outputDir, '@amritk/helpers') ? 'package' : 'embedded'
