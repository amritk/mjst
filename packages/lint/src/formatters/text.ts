import { type Formatter, SEVERITY_LABEL } from './common'

/** Compact one-line-per-finding `source:line:col severity message (code)` output. */
export const text: Formatter = (results) =>
  results
    .map((r) => {
      const pos = `${r.range.start.line + 1}:${r.range.start.character + 1}`
      return `${r.source ?? '<stdin>'}:${pos} ${SEVERITY_LABEL[r.severity]} ${r.message} (${r.code})`
    })
    .join('\n')
