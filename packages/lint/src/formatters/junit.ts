import { escapeXml, type Formatter } from './common'

/** JUnit XML, with one `<testcase>` failure per finding. */
export const junit: Formatter = (results) => {
  const cases = results
    .map((r) => {
      const name = escapeXml(`${r.source ?? ''}:${r.range.start.line + 1}`)
      const message = escapeXml(`${r.code}: ${r.message}`)
      return `    <testcase name="${name}"><failure message="${message}">${message}</failure></testcase>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="lint" tests="${results.length}" failures="${results.length}">\n${cases}\n  </testsuite>\n</testsuites>`
}
