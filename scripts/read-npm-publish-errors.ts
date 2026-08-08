import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * A single npm debug log worth reading, trimmed and redacted.
 */
export type PublishErrorLog = {
  /** The debug log's file name, so a run can be matched back to its log. */
  file: string
  /** The lines worth reading, in the order npm wrote them. */
  lines: string[]
}

/**
 * npm's canned 403 text ("in most cases, you or one of your dependencies are
 * requesting a package version that is forbidden by your security policy") is
 * what it prints when the registry sends no reason at all, and that is exactly
 * the text a failed release job shows. The request, the response status, and
 * the OIDC token exchange that preceded it are only in npm's own debug log,
 * which the job discards when the runner goes away.
 *
 * @amritk/mjst and @amritk/resolve-refs have 403'd on every release since
 * 2026-08-04 while the other ten packages publish from the same job, the same
 * OIDC identity, and the same workflow file, so the reason has to come from the
 * registry rather than from anything visible in the repo.
 */
const INTERESTING = [/\berror code E\d/, /\bfetch (?:PUT|POST|GET) [45]\d\d\b/]

/**
 * Lines every npm run writes regardless of what it did. Dropping them keeps a
 * printed log short enough to read in a job summary; everything else is kept,
 * because guessing which line explains a failure is how the reason gets lost.
 */
const BOILERPLATE = [/^\d+ silly config /, /^\d+ silly logfile /, /^\d+ silly packumentCache /]

/**
 * Anything shaped like a credential. npm's OIDC exchange trades a GitHub ID
 * token for a short-lived publish token scoped to one package, and both are
 * live credentials while they last — a debug log is not the place to find out
 * whether npm redacted them on our behalf.
 */
const SECRETS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted jwt]'],
  [/\bnpm[a-z]*_[A-Za-z0-9]{16,}\b/g, '[redacted token]'],
  [/\b(authorization|bearer)\b(\s*[:=]?\s*)\S+/gi, '$1$2[redacted]'],
]

/** Masks every credential-shaped run in a line, leaving the prose around it intact. */
export const redact = (line: string): string =>
  SECRETS.reduce((redacted, [pattern, mask]) => redacted.replace(pattern, mask), line)

/**
 * Reads npm's debug logs and returns the ones that recorded a failed request.
 *
 * A `changeset publish` across the workspace runs `npm publish` once per
 * package, and each run writes its own log, so this picks out the handful that
 * failed rather than making someone read twelve.
 */
export const readNpmPublishErrors = async (logsDir: string): Promise<PublishErrorLog[]> => {
  let entries: string[]
  try {
    entries = await readdir(logsDir)
  } catch {
    return []
  }

  const failures: PublishErrorLog[] = []

  for (const file of entries.filter((name) => name.endsWith('.log')).sort()) {
    const lines = (await readFile(join(logsDir, file), 'utf-8')).split('\n')
    if (!lines.some((line) => INTERESTING.some((pattern) => pattern.test(line)))) continue

    failures.push({
      file,
      lines: lines.filter((line) => line !== '' && !BOILERPLATE.some((pattern) => pattern.test(line))).map(redact),
    })
  }

  return failures
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logsDir = process.argv[2] ?? join(homedir(), '.npm', '_logs')

  readNpmPublishErrors(logsDir)
    .then((failures) => {
      if (failures.length === 0) {
        console.log(`No npm debug log in ${logsDir} recorded a failed request.`)
        return
      }

      for (const { file, lines } of failures) {
        console.log(`\n===== ${file} =====`)
        for (const line of lines) console.log(line)
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
