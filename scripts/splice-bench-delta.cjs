'use strict'

const START = '<!-- mjst-bench-delta:start -->'
const END = '<!-- mjst-bench-delta:end -->'

/**
 * Splices the bench delta `table` into a PR description `body` between the
 * mjst-bench-delta markers: replace an existing well-formed block in place,
 * otherwise append. CommonJS so the bench.yml github-script step can
 * `require` it straight from the checkout, and a plain function so it is unit
 * testable.
 *
 * Dangling markers are repaired rather than trusted: a start marker without an
 * end marker AFTER it (or any stray markers outside the recognized block)
 * would otherwise poison the NEXT run — its indexOf would pair the stale start
 * with the freshly appended block's end and splice away every hand-written
 * line in between. Any marker text left over after the well-formed block is
 * handled is stripped before appending.
 *
 * @param {string | null | undefined} body
 * @param {string} table markdown block that itself starts with START and ends with END
 * @returns {string}
 */
const spliceBenchDelta = (body, table) => {
  const current = body ?? ''
  const startIdx = current.indexOf(START)
  // Only an end marker AFTER the start marker forms a block; an earlier one is stray.
  const endIdx = startIdx === -1 ? -1 : current.indexOf(END, startIdx + START.length)

  if (startIdx !== -1 && endIdx !== -1) {
    return current.slice(0, startIdx) + table.trim() + current.slice(endIdx + END.length)
  }

  // No well-formed block: strip stray/dangling markers, then append.
  const cleaned = current.split(START).join('').split(END).join('')
  const head = cleaned.trimEnd()
  return head.length > 0 ? `${head}\n\n${table.trim()}\n` : `${table.trim()}\n`
}

module.exports = { spliceBenchDelta, START, END }
