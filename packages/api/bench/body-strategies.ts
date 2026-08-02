/**
 * How much of the POST case is the body read, and would reading it a different
 * way be faster inside workerd?
 *
 * The engines buffer the body as bytes and decode it in JS, because all three
 * readers (`readBody`, `readText`, `readBytes`) have to stay available on the
 * same request — a webhook handler verifying an HMAC needs the exact bytes the
 * pipeline already parsed. workerd also offers native `Request.json()` and
 * `Request.text()`, which decode in C++ and cannot be re-read. This measures
 * what that trade is actually worth before anyone trades it away.
 *
 * **The measurement is paired, and that is the whole point.** Measuring each
 * strategy separately and comparing medians did not survive contact with this
 * machine: repeated readings of the *same* strategy ranged from 15k to 53k
 * ops/s, a spread far wider than the difference being looked for, and a single
 * cold isolate read 33k for a strategy that reads 45k warm. So each round runs
 * every strategy back to back inside one isolate and records their rates
 * together; the comparison is the per-round *ratio* to a fixed baseline
 * strategy, and the report is the median of those ratios. A slow patch of
 * machine time then scales every strategy in that round equally and divides
 * out, instead of landing on whichever strategy happened to run during it.
 *
 * Run with: bun run bench:workerd:body
 */

const BODY = JSON.stringify({ id: 1, name: 'Ada', email: 'ada@example.com' })
const DECODER = new TextDecoder()

/** A fresh request per op, exactly as the cross-framework bench builds them. */
const makeRequest = (): Request =>
  new Request('http://localhost/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(BODY.length) },
    body: BODY,
  })

type Strategy = { readonly label: string; readonly read: (request: Request) => Promise<unknown> }

export const STRATEGIES: readonly Strategy[] = [
  {
    // The baseline: what both engines do today, via `readBodyCapped`.
    label: 'arrayBuffer → Uint8Array → decode → parse',
    read: async (request) => {
      const buffer = await request.arrayBuffer()
      return JSON.parse(DECODER.decode(new Uint8Array(buffer))) as unknown
    },
  },
  {
    // Same buffered-bytes invariant, minus the wrapper: TextDecoder takes an
    // ArrayBuffer directly, and `readBytes` could wrap only when asked.
    label: 'arrayBuffer → decode → parse',
    read: async (request) => {
      const buffer = await request.arrayBuffer()
      return JSON.parse(DECODER.decode(buffer)) as unknown
    },
  },
  {
    // Native UTF-8 decode, JSON.parse in JS. Gives up `readBytes` on the same
    // request — the exact bytes are gone once the body is consumed as text.
    label: 'native text() → parse',
    read: async (request) => JSON.parse(await request.text()) as unknown,
  },
  {
    // What Hono does. Gives up both `readText` and `readBytes`.
    label: 'native json()',
    read: async (request) => request.json(),
  },
]

const RATE_TRIAL_MS = 100
const RATE_TRIALS = 7

/** Throughput for one strategy, as the median of a handful of short trials. */
const rateOf = async (strategy: Strategy): Promise<number> => {
  let sink = 0
  const samples: number[] = []
  for (let trial = 0; trial < RATE_TRIALS; trial++) {
    let ops = 0
    const start = performance.now()
    const end = start + RATE_TRIAL_MS
    while (performance.now() < end) {
      for (let i = 0; i < 25; i++) sink += ((await strategy.read(makeRequest())) as { id: number }).id
      ops += 25
    }
    samples.push((ops / (performance.now() - start)) * 1000)
  }
  if (!Number.isFinite(sink)) throw new Error('benchmark sink overflowed')
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] ?? 0
}

export type BodyRound = { readonly label: string; readonly rate: number }

/**
 * Every strategy, measured back to back, `rounds` times over.
 *
 * Two things here are deliberate and both were learned the hard way.
 *
 * **The order rotates each round.** Whichever strategy runs first after the
 * warmup absorbs the residual JIT and collection cost of the warmup itself —
 * measured, the first slot read 23k ops/s for a strategy that reads 38k from
 * any other slot. Rotating by one each round puts every strategy in the first
 * slot equally often, so that penalty spreads across all of them instead of
 * permanently taxing whichever happened to be listed first.
 *
 * **Every round runs in this one isolate.** A fresh isolate per round would be
 * cleaner in principle, but isolate startup dominates the run badly enough to
 * make a multi-round sweep untimeable. The pairing is what makes that
 * acceptable: the comparison is a ratio *within* a round, so whatever heap
 * state a round inherits scales its strategies together and divides out.
 */
export const runBodyRounds = async (rounds: number, warmupMs: number): Promise<readonly (readonly BodyRound[])[]> => {
  let sink = 0
  const warmupEnd = performance.now() + warmupMs
  while (performance.now() < warmupEnd) {
    for (const strategy of STRATEGIES) sink += ((await strategy.read(makeRequest())) as { id: number }).id
  }
  if (!Number.isFinite(sink)) throw new Error('benchmark sink overflowed')

  const all: (readonly BodyRound[])[] = []
  for (let round = 0; round < rounds; round++) {
    const measured: BodyRound[] = []
    for (let offset = 0; offset < STRATEGIES.length; offset++) {
      const strategy = STRATEGIES[(round + offset) % STRATEGIES.length]
      if (strategy === undefined) continue
      measured.push({ label: strategy.label, rate: await rateOf(strategy) })
    }
    all.push(measured)
  }
  return all
}
