import pc from 'picocolors'

import { colorize, type Formatter, SEVERITY_LABEL } from './common'

/** Two-line-per-finding colored output with the source position dimmed. */
export const pretty: Formatter = (results) =>
  results
    .map((r) => {
      const pos = `${r.source ?? '<stdin>'}:${r.range.start.line + 1}:${r.range.start.character + 1}`
      return `${colorize(r.severity, SEVERITY_LABEL[r.severity])} ${pc.dim(pos)}\n  ${r.message} ${pc.dim(`(${r.code})`)}`
    })
    .join('\n\n')
