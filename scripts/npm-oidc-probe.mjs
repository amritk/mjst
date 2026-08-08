import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Why the release job's 403s say nothing useful.
//
// npm publishes here through trusted publishing (OIDC), and npm's OIDC handler is
// written to never throw: it asks GitHub for an ID token, POSTs it to
// `/-/npm/v1/oidc/token/exchange/package/<name>` for a short-lived npm token, and on
// *any* failure logs one line at `verbose` and returns. `npm publish` then runs with
// whatever auth is in .npmrc — which is nothing — and the registry answers 403 with
// its generic "forbidden by your security policy" text. The exchange is per package,
// so a workspace can publish ten packages and 403 on two with no visible difference
// between them, which is exactly what @amritk/mjst and @amritk/resolve-refs have been
// doing since 2026-08-04 while the other ten went out of the same job.
//
// This runs the same exchange by hand for every publishable package and prints the
// status and error body npm swallows, so the two halves of the failure can be told
// apart: an exchange that fails names its reason here, and an exchange that succeeds
// moves the fault to the PUT itself — a registry-side publishing-access policy rather
// than anything about the token.
//
// Read-only. It requests tokens and reads whoami/visibility; it publishes nothing.
// Tokens are never printed — only statuses, error messages, and the ID token claims
// npm matches against a package's trusted publisher config.

const REGISTRY = 'https://registry.npmjs.org'
const AUDIENCE = 'npm:registry.npmjs.org'

/** Every workspace package that release:publish would hand to npm. */
const publishablePackages = () => {
  const root = join(import.meta.dirname, '..', 'packages')
  return readdirSync(root)
    .map((dir) => join(root, dir, 'package.json'))
    .map((path) => {
      try {
        return JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        return null
      }
    })
    .filter((manifest) => manifest?.name && !manifest.private)
    .map((manifest) => manifest.name)
    .sort()
}

/** npm escapes a scoped name for the URL path as `@scope%2fname`. */
const escapeName = (name) => name.replace('/', '%2f')

/** The claims npm matches against a package's trusted publisher configuration. */
const claims = (idToken) => {
  const payload = idToken.split('.')[1]
  if (!payload) return {}
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
}

const body = async (response) => {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 400) }
  }
}

const idToken = async () => {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !token) {
    throw new Error('No ACTIONS_ID_TOKEN_* in env — the job is missing `id-token: write`')
  }
  const response = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  const json = await body(response)
  if (!response.ok || !json.value) {
    throw new Error(`GitHub refused the ID token: ${response.status} ${JSON.stringify(json)}`)
  }
  return json.value
}

/** The exchange npm performs per package, with the failure reason left visible. */
const exchange = async (name, token) => {
  const response = await fetch(
    `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${escapeName(name)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  )
  const json = await body(response)
  // Never print `json.token` — it is a live publish credential for this package.
  return { status: response.status, token: json.token, message: json.message ?? json.error ?? json.raw }
}

/** Whether the exchanged token actually carries authority for the package. */
const probeToken = async (name, token) => {
  const [who, visibility] = await Promise.all([
    fetch(`${REGISTRY}/-/whoami`, { headers: { Authorization: `Bearer ${token}` } }).then(body),
    fetch(`${REGISTRY}/-/package/${escapeName(name)}/visibility`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(body),
  ])
  return { whoami: who.username ?? who.message ?? who.error, visibility }
}

const token = await idToken()
const { repository, workflow_ref, job_workflow_ref, ref, repository_visibility } = claims(token)

console.log('ID token claims npm matches against each trusted publisher config:')
console.log(`  repository:            ${repository}`)
console.log(`  ref:                   ${ref}`)
console.log(`  workflow_ref:          ${workflow_ref}`)
console.log(`  job_workflow_ref:      ${job_workflow_ref}`)
console.log(`  repository_visibility: ${repository_visibility}`)
console.log('')

let failed = 0
for (const name of publishablePackages()) {
  const result = await exchange(name, token)
  if (result.token) {
    const { whoami, visibility } = await probeToken(name, result.token)
    console.log(`✅ ${name}: exchange ${result.status}, whoami ${whoami}, visibility ${JSON.stringify(visibility)}`)
  } else {
    failed += 1
    console.log(`❌ ${name}: exchange ${result.status} — ${result.message ?? 'no message'}`)
  }
}

console.log('')
console.log(
  failed === 0
    ? 'Every exchange succeeded. The 403 is the registry refusing the PUT itself, not the token — look at each package\'s Publishing access setting on npmjs.com.'
    : `${failed} package(s) could not obtain a token. The message above is the reason npm's publish path logs only at --loglevel verbose.`,
)
