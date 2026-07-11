import { compileQuery } from './jsonpath'
import type { JsonPath, RuleEntry, RulesetDefinition } from './types'

/** A problem found in a ruleset definition (structural, not a document finding). */
export type IRulesetProblem = {
  message: string
  /** Path into the ruleset object, joined with `.` for display. */
  path: JsonPath
}

const SEVERITIES = new Set(['error', 'warn', 'info', 'hint', 'off'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidSeverity = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 3
  return typeof value === 'string' && SEVERITIES.has(value)
}

const validateThen = (then: unknown, path: JsonPath, problems: IRulesetProblem[]): void => {
  const entries = Array.isArray(then) ? then : [then]
  entries.forEach((entry, index) => {
    const at = Array.isArray(then) ? [...path, index] : path
    if (!isObject(entry)) {
      problems.push({ message: '`then` must be an object (or array of objects)', path: at })
      return
    }
    const fn = entry['function']
    if (typeof fn !== 'string' && typeof fn !== 'function') {
      problems.push({ message: '`then.function` must be a function name or reference', path: [...at, 'function'] })
    }
    if (entry['field'] !== undefined && typeof entry['field'] !== 'string') {
      problems.push({ message: '`then.field` must be a string', path: [...at, 'field'] })
    }
  })
}

const validateRule = (name: string, entry: RuleEntry, path: JsonPath, problems: IRulesetProblem[]): void => {
  // Shorthand: boolean toggle or a severity string.
  if (typeof entry === 'boolean') return
  if (typeof entry === 'string') {
    if (!isValidSeverity(entry)) {
      problems.push({ message: `Rule "${name}" has invalid severity "${entry}"`, path })
    }
    return
  }
  if (!isObject(entry)) {
    problems.push({ message: `Rule "${name}" must be an object, boolean, or severity string`, path })
    return
  }
  if (entry['given'] === undefined) {
    problems.push({ message: `Rule "${name}" is missing \`given\``, path: [...path, 'given'] })
  } else if (typeof entry['given'] !== 'string' && !Array.isArray(entry['given'])) {
    problems.push({ message: `Rule "${name}" \`given\` must be a string or array`, path: [...path, 'given'] })
  } else {
    // Flag a malformed JSONPath expression so it does not silently match nothing
    // at run time. Alias references (`#Alias`) are only valid once expanded, so
    // they are skipped here.
    const givens = Array.isArray(entry['given']) ? entry['given'] : [entry['given']]
    givens.forEach((given, index) => {
      if (typeof given !== 'string' || given.startsWith('#')) return
      const error = compileQuery(given).error
      if (error !== undefined) {
        const at = Array.isArray(entry['given']) ? [...path, 'given', index] : [...path, 'given']
        problems.push({ message: `Rule "${name}" has an invalid \`given\` "${given}": ${error}`, path: at })
      }
    })
  }
  if (entry['then'] === undefined) {
    problems.push({ message: `Rule "${name}" is missing \`then\``, path: [...path, 'then'] })
  } else {
    validateThen(entry['then'], [...path, 'then'], problems)
  }
  if (entry['severity'] !== undefined && !isValidSeverity(entry['severity'])) {
    problems.push({ message: `Rule "${name}" has invalid severity`, path: [...path, 'severity'] })
  }
  if (entry['formats'] !== undefined && !Array.isArray(entry['formats'])) {
    problems.push({ message: `Rule "${name}" \`formats\` must be an array`, path: [...path, 'formats'] })
  }
}

/**
 * Validates the *shape* of a ruleset definition, returning a list of problems
 * (empty when valid). This is a lightweight structural check — it does not load
 * `extends` targets or verify that referenced functions exist — so a malformed
 * ruleset surfaces actionable diagnostics instead of failing obscurely at runtime.
 */
export const validateRuleset = (definition: unknown): IRulesetProblem[] => {
  const problems: IRulesetProblem[] = []
  if (!isObject(definition)) {
    return [{ message: 'Ruleset must be an object', path: [] }]
  }

  if (definition['rules'] !== undefined) {
    if (!isObject(definition['rules'])) {
      problems.push({ message: '`rules` must be an object', path: ['rules'] })
    } else {
      for (const [name, entry] of Object.entries(definition['rules'])) {
        validateRule(name, entry as RuleEntry, ['rules', name], problems)
      }
    }
  }

  const ext = definition['extends']
  if (ext !== undefined && typeof ext !== 'string' && !Array.isArray(ext) && !isObject(ext)) {
    problems.push({ message: '`extends` must be a string, array, or object', path: ['extends'] })
  }

  if (definition['overrides'] !== undefined && !Array.isArray(definition['overrides'])) {
    problems.push({ message: '`overrides` must be an array', path: ['overrides'] })
  } else if (Array.isArray(definition['overrides'])) {
    definition['overrides'].forEach((override, index) => {
      if (!isObject(override) || !Array.isArray(override['files'])) {
        problems.push({ message: 'Each override must have a `files` array', path: ['overrides', index] })
      }
    })
  }

  if (definition['functions'] !== undefined && !Array.isArray(definition['functions'])) {
    problems.push({ message: '`functions` must be an array of names', path: ['functions'] })
  }
  if (definition['formats'] !== undefined && !Array.isArray(definition['formats'])) {
    problems.push({ message: '`formats` must be an array', path: ['formats'] })
  }

  // A ruleset with neither rules nor extends does nothing — flag it.
  if (
    (definition as RulesetDefinition).rules === undefined &&
    (definition as RulesetDefinition).extends === undefined
  ) {
    problems.push({ message: 'Ruleset has no `rules` and no `extends` (it will produce no findings)', path: [] })
  }

  return problems
}
