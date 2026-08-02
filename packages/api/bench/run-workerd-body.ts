import { Miniflare } from 'miniflare'

/**
 * Driver for the paired body-read comparison in `bench/body-strategies.ts`.
 *
 * Each round is one fresh isolate that measures every strategy back to back.
 * The comparison is the per-round ratio to the first strategy (what the
 * engines do today), and the headline is the median of those ratios across
 * rounds — so a slow round scales every strategy in it equally and cancels.
 * Absolute rates are printed too, but they are the noisy number here and the
 * ratio is the one to read.
 *
 * Run with: bun run bench:workerd:body
 */

const WORKER = './bench/.fixtures/workerd-body.mjs'
const ROUNDS = Number(process.env['ROUNDS'] ?? 7)
const WARMUP_MS = Number(process.env['WARMUP_MS'] ?? 1500)

type Round = { readonly label: string; readonly rate: number }

/** What the engines do today; every ratio is against this. */
const BASELINE = 'arrayBuffer → Uint8Array → decode → parse'

const allRounds = async (): Promise<readonly (readonly Round[])[]> => {
  const mf = new Miniflare({
    modules: true,
    scriptPath: WORKER,
    compatibilityDate: '2025-01-01',
    compatibilityFlags: ['nodejs_compat'],
  })
  try {
    const response = await mf.dispatchFetch(`http://localhost/?rounds=${ROUNDS}&warmupMs=${WARMUP_MS}`)
    const body = await response.json()
    if (!response.ok) throw new Error(`worker replied ${response.status}: ${JSON.stringify(body)}`)
    return body as readonly (readonly Round[])[]
  } finally {
    await mf.dispose()
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const pad = (value: string, width: number): string => value.padEnd(width)
const padStart = (value: string, width: number): string => value.padStart(width)

console.log('\n=== body read strategies, inside workerd ===\n')
console.log(`${ROUNDS} rounds in one isolate, every strategy measured back to back inside`)
console.log('the round, rotating which one goes first. "vs today" is the median of the')
console.log('per-round ratios against what the engines do today — paired, so drift')
console.log('cancels instead of landing on whichever strategy ran during it.\n')

const byLabel = new Map<string, number[]>()
const ratios = new Map<string, number[]>()
for (const results of await allRounds()) {
  // The baseline is found by label, not by position: the order rotates each
  // round, so position 0 is a different strategy every time.
  const baseline = results.find((result) => result.label === BASELINE)?.rate ?? 0
  for (const result of results) {
    const rates = byLabel.get(result.label) ?? []
    rates.push(result.rate)
    byLabel.set(result.label, rates)
    if (baseline > 0) {
      const scaled = ratios.get(result.label) ?? []
      scaled.push(result.rate / baseline)
      ratios.set(result.label, scaled)
    }
  }
}

console.log(`  ${pad('strategy', 44)}${padStart('median', 12)}${padStart('vs today', 12)}${padStart('spread', 16)}`)
for (const [label, rates] of byLabel) {
  const scaled = ratios.get(label) ?? []
  const sorted = [...rates].sort((a, b) => a - b)
  console.log(
    `  ${pad(label, 44)}${padStart(`${Math.round(median(rates) / 1000)}k`, 12)}${padStart(`${median(scaled).toFixed(2)}x`, 12)}${padStart(`${Math.round((sorted[0] ?? 0) / 1000)}k..${Math.round((sorted[sorted.length - 1] ?? 0) / 1000)}k`, 16)}`,
  )
}
console.log('')
