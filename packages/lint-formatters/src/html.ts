import { escapeXml, type Formatter, SEVERITY_LABEL } from './common'

/** Standalone HTML report with a table of findings. */
export const html: Formatter = (results) => {
  const rows = results
    .map((r) => {
      const pos = `${r.range.start.line + 1}:${r.range.start.character + 1}`
      return `    <tr><td>${escapeXml(r.source ?? '')}</td><td>${pos}</td><td>${SEVERITY_LABEL[r.severity]}</td><td>${escapeXml(r.message)}</td><td>${escapeXml(String(r.code))}</td></tr>`
    })
    .join('\n')
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Lint results</title></head>
<body>
  <h1>Lint results (${results.length})</h1>
  <table border="1">
    <thead><tr><th>Source</th><th>Location</th><th>Severity</th><th>Message</th><th>Rule</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`
}
