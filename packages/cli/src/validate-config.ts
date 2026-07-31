/**
 * The JSON type each config key accepts, mirroring `config.schema.json`.
 * `boolean|string` is `banner`'s `"type": ["boolean", "string"]`.
 */
type ConfigValueType = 'string' | 'boolean' | 'boolean|string' | 'string[]'

/** One key's contract: its JSON type, plus the closed value set when it has one. */
type ConfigKeySpec = {
  readonly type: ConfigValueType
  readonly enum?: readonly string[]
}

/**
 * Every key a config file may carry, kept in lockstep with `config.schema.json`
 * by `validate-config.test.ts`.
 *
 * The schema itself would be the obvious thing to validate against at runtime,
 * but it is deliberately not shipped in the published package (see `help-text.ts`
 * for the same trade-off), and `@amritk/runtime-validators` — the interpreter that
 * would run it — is not a declared dependency of this package. So the contract
 * lives here as data, and the test pins it to the schema so the two cannot drift.
 * (Exported for exactly that test — nothing else should read it.)
 */
export const CONFIG_KEYS: Record<string, ConfigKeySpec> = {
  schema: { type: 'string' },
  schemaDir: { type: 'string' },
  input: { type: 'string', enum: ['json', 'typebox', 'zod', 'valibot', 'effect'] },
  export: { type: 'string' },
  outDir: { type: 'string' },
  outFile: { type: 'string' },
  typesOnly: { type: 'boolean' },
  validators: { type: 'boolean' },
  examples: { type: 'boolean' },
  build: { type: 'boolean' },
  force: { type: 'boolean' },
  logWarnings: { type: 'boolean' },
  strict: { type: 'boolean' },
  stripUnknown: { type: 'boolean' },
  caseInsensitive: { type: 'boolean' },
  readonly: { type: 'boolean' },
  helpers: { type: 'string', enum: ['package', 'embedded'] },
  typeSuffix: { type: 'string' },
  banner: { type: 'boolean|string' },
  importExt: { type: 'string', enum: ['js', 'ts'] },
  rootType: { type: 'string' },
  resolveRemote: { type: 'boolean' },
  allowedHosts: { type: 'string[]' },
  allowPrivateHosts: { type: 'boolean' },
  allowedRoots: { type: 'string[]' },
  config: { type: 'string' },
}

/** The JSON type name of a value, for the "received …" half of an error. */
const typeNameOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const matchesType = (value: unknown, type: ConfigValueType): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'boolean|string':
      return typeof value === 'boolean' || typeof value === 'string'
    case 'string[]':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  }
}

/**
 * Checks a parsed config file against the key contract, throwing with every
 * problem found (JSON Pointer + what was expected).
 *
 * Before this, each key was guarded by a `typeof` check whose failure branch was
 * "drop it": `{"strcit": true, "strict": "true"}` generated non-strict output and
 * exited 0, while the very same typo on the command line was rejected. A config
 * file has to be at least as strict as the flags it stands in for.
 *
 * Note what this does *not* buy: a config is still trusted code. `schema` plus a
 * non-`json` `input` makes `load-schema-module.ts` `import()` whatever path the
 * config names, so an untrusted `mjst.config.json` still reaches arbitrary module
 * evaluation. Validating the shape does not change that — do not run mjst against
 * a config file you would not run as a script.
 */
export const validateConfig = (parsed: Record<string, unknown>, configPath: string): void => {
  const problems: string[] = []
  const knownKeys = Object.keys(CONFIG_KEYS)

  for (const [key, value] of Object.entries(parsed)) {
    const spec = CONFIG_KEYS[key]

    if (!spec) {
      // `$schema` is how editors attach the config schema for completion; it is
      // metadata about the file, not an option, so it is always welcome.
      if (key === '$schema') continue
      problems.push(`  /${key}: unknown option. Known options: ${knownKeys.join(', ')}.`)
      continue
    }

    if (!matchesType(value, spec.type)) {
      problems.push(`  /${key}: expected ${spec.type}, received ${typeNameOf(value)}.`)
      continue
    }

    if (spec.enum && typeof value === 'string' && !spec.enum.includes(value)) {
      problems.push(`  /${key}: expected one of ${spec.enum.join(', ')}, received "${value}".`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid config file ${configPath}:\n${problems.join('\n')}`)
  }
}
