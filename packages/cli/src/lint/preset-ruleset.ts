import type { Ruleset } from '@amritk/lint'
import type { RulesetDefinition } from '@amritk/lint/types'

/**
 * Routing a ruleset to the right builder: which names mean a built-in preset,
 * whether a ruleset the CLI loaded off disk names one, and how to build with it.
 * The three live together rather than one per file because they are a single
 * concern — the name table is the whole question — and because the two entry
 * points must agree on it: `--ruleset <name>` and a loaded ruleset's `extends`
 * accept exactly the same preset names.
 */

/**
 * The two built-in presets the CLI can build a ruleset with. They are mutually
 * exclusive: each preset only knows how to resolve its *own* name inside
 * `extends`, and each brings a different format registry, so one ruleset cannot
 * be built with both.
 */
export type PresetName = 'asyncapi' | 'oas'

/**
 * Every name that resolves to a built-in preset — as `--ruleset <name>` and
 * inside a ruleset's `extends` — mapped to the preset it names. The aliases
 * mirror what the presets' own `extends` resolution accepts, including the
 * legacy Spectral ones.
 *
 * A Map, not a record: the key comes straight from user input, and a record
 * lookup on `constructor` would find `Object.prototype`'s.
 */
export const PRESET_RULESET_NAMES: ReadonlyMap<string, PresetName> = new Map<string, PresetName>([
  ['asyncapi', 'asyncapi'],
  ['loupe:asyncapi', 'asyncapi'],
  ['spectral:asyncapi', 'asyncapi'],
  ['oas', 'oas'],
  ['loupe:oas', 'oas'],
  ['spectral:oas', 'oas'],
])

/** Collects the presets named by `definition`'s `extends`, following inline nested definitions. */
const collectPresets = (definition: RulesetDefinition, into: Map<PresetName, string>, seen: Set<unknown>): void => {
  // A definition that is not an object carries no `extends`. Reporting that is
  // `validateRuleset`'s job — this walker just has to not fall over on the way.
  if (typeof definition !== 'object' || definition === null) return
  if (seen.has(definition)) return
  seen.add(definition)
  if (!definition.extends) return
  const entries = Array.isArray(definition.extends) ? definition.extends : [definition.extends]
  for (const entry of entries) {
    // An entry is either the target itself or a `[target, severityLevel]` tuple.
    const target = Array.isArray(entry) ? entry[0] : entry
    if (typeof target === 'string') {
      const preset = PRESET_RULESET_NAMES.get(target)
      // Keep the first spelling we saw so the error names what the user wrote.
      if (preset && !into.has(preset)) into.set(preset, target)
    } else {
      collectPresets(target, into, seen)
    }
  }
}

/**
 * Finds the built-in preset a loaded ruleset extends. Returns `undefined` when
 * the ruleset extends nothing but files and packages — those resolve fine
 * through the core path and must keep doing so.
 *
 * Only the names are inspected here; a preset reached indirectly (through an
 * `extends` of a file that itself extends `asyncapi`) is not found, because
 * following it would mean loading — and, for a `.js` ruleset, executing — the
 * file a second time.
 *
 * @param label - How to name the ruleset in the "both presets" error, e.g. its path.
 * @throws When the ruleset extends both presets, which no single builder can resolve.
 */
const findExtendedPreset = (definition: RulesetDefinition, label: string): PresetName | undefined => {
  const found = new Map<PresetName, string>()
  collectPresets(definition, found, new Set())
  const asyncapi = found.get('asyncapi')
  const oas = found.get('oas')
  if (asyncapi && oas) {
    throw new Error(
      `Ruleset ${label} extends both built-in presets ("${asyncapi}" and "${oas}"), which cannot be combined: ` +
        'each preset brings its own functions and format detectors, and neither can resolve the other. ' +
        'Extend at most one preset per ruleset, and lint AsyncAPI and OpenAPI documents in separate runs.',
    )
  }
  return asyncapi ? 'asyncapi' : oas ? 'oas' : undefined
}

/**
 * Builds a *runnable* ruleset with a preset's builder. Built rather than handed
 * to `lintDocument` as data, deliberately: a preset brings its own custom
 * functions and format detectors, which a definition cannot carry — as data,
 * every one of its rules would be silently skipped (unknown functions, a
 * `formats` gate matching nothing).
 *
 * With no `definition` this is the bare `--ruleset asyncapi` case: the preset's
 * recommended rules and nothing else. With one, the caller's ruleset is built by
 * the preset, whose `extends` resolution knows the preset names and whose
 * `basePath` keeps the user's relative `extends` and `functions` resolving next
 * to their own file.
 *
 * No `restrictTo` is passed, which matches what the core path does for a
 * discovered or `--ruleset` file today: the CLI treats a ruleset on the local
 * disk as trusted configuration. (`--allowed-roots` fences `$ref` resolution in
 * the *document*, a separate concern.) See the "Trust boundary" section of
 * `@amritk/lint`'s README.
 */
export const buildPresetRuleset = async (
  preset: PresetName,
  definition?: RulesetDefinition,
  basePath?: string,
): Promise<Ruleset> => {
  if (preset === 'asyncapi') {
    const { createAsyncApiRuleset } = await import('@amritk/lint/rules/asyncapi')
    return createAsyncApiRuleset(definition, basePath)
  }
  const { createOpenApiRuleset } = await import('@amritk/lint/rules/openapi')
  return createOpenApiRuleset(definition, basePath)
}

/**
 * Decides what `lintDocument` should run for a ruleset just loaded off disk —
 * whether it came from `--ruleset <file>` or `.lint.*` discovery.
 *
 * A ruleset that extends a built-in preset has to be built *here*, by that
 * preset's builder: handed over as a definition, `lintDocument` builds it with
 * the core `createRuleset`, which knows neither the preset names nor the
 * functions and format detectors a preset brings. Anything else stays a
 * definition and takes the core path exactly as it did before.
 *
 * @param basePath - The ruleset file's own directory, so its relative `extends` and `functions` still resolve there.
 * @param label - How to name the ruleset in an error, e.g. its path.
 */
export const buildLoadedRuleset = async (
  definition: RulesetDefinition,
  basePath: string,
  label: string,
): Promise<RulesetDefinition | Ruleset> => {
  const preset = findExtendedPreset(definition, label)
  return preset ? await buildPresetRuleset(preset, definition, basePath) : definition
}
