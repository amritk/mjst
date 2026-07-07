import { codeClimate } from './code-climate'
import type { Formatter } from './common'
import { githubActions } from './github-actions'
import { gitlab } from './gitlab'
import { html } from './html'
import { json } from './json'
import { junit } from './junit'
import { pretty } from './pretty'
import { sarif } from './sarif'
import { stylish } from './stylish'
import { teamcity } from './teamcity'
import { text } from './text'

export { codeClimate } from './code-climate'
export type { Formatter } from './common'
export { githubActions } from './github-actions'
export { gitlab } from './gitlab'
export { html } from './html'
export { json } from './json'
export { junit } from './junit'
export { pretty } from './pretty'
export { sarif } from './sarif'
export { stylish } from './stylish'
export { teamcity } from './teamcity'
export { text } from './text'

/** The names a CLI `--format` flag accepts, one per built-in formatter. */
export type FormatterName =
  | 'stylish'
  | 'json'
  | 'pretty'
  | 'junit'
  | 'github-actions'
  | 'text'
  | 'teamcity'
  | 'code-climate'
  | 'gitlab'
  | 'sarif'
  | 'html'

/** Every built-in formatter, keyed by its CLI name. */
export const formatters: Record<FormatterName, Formatter> = {
  stylish,
  json,
  pretty,
  junit,
  'github-actions': githubActions,
  text,
  teamcity,
  'code-climate': codeClimate,
  gitlab,
  sarif,
  html,
}

/** Looks up a formatter by name, throwing with the available names if unknown. */
export const getFormatter = (name: string): Formatter => {
  const formatter = formatters[name as FormatterName]
  if (!formatter) throw new Error(`Unknown formatter "${name}". Available: ${Object.keys(formatters).join(', ')}`)
  return formatter
}
