/**
 * One isolated leaderboard-conditions measurement run: **all four modes in one
 * process**.
 *
 * The four are the two parse cases (`parseSafe`, `parseStrict`) times the two
 * harness modes (`discarded`, `observed`), for a single library. Running them
 * together is the point rather than a shortcut: a parser's headline number under
 * this harness depends on whether the engine can inline it into benny's loop and
 * escape-analyse the object it returns, and that is a property of the whole
 * process — one worker per measurement would hide the four numbers' relationship
 * to each other behind four different JIT warm-ups. Libraries still get a
 * process each, which is the isolation upstream actually relies on ("isolated
 * node processes for each benchmarked package").
 *
 * Plain JavaScript because it has to run under Node as well as Bun, and Node
 * cannot import this package's TypeScript sources. The one thing it cannot build
 * for itself is the mjst parser (that needs the generator, which is TypeScript);
 * the orchestrator generates and transpiles both modes first and passes the
 * module paths in.
 *
 *   usage: <bun|node> bench/moltar-worker.mjs <libraryId> [safeModule] [strictModule]
 */

import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Value } from '@sinclair/typebox/value'
import benny from 'benny'

import {
  isStrictCase,
  MOLTAR_MODES,
  MOLTAR_PARSE_CASES,
  ParseDiscarded,
  ParseObserved,
  parseData,
  parseDataWithExtras,
  parseTypebox,
  parseZod,
} from './moltar-data.mjs'

const [libId, safeModule, strictModule] = process.argv.slice(2)

/**
 * Builds the ready-to-run parser for one case — the same construction
 * `parsers.ts` uses, so this table and the package's own table time the same
 * functions and only the harness around them differs.
 *
 * `noop` is the control: a "parser" that checks nothing and hands the input
 * straight back. It pins benny's per-operation cost, so a result at that ceiling
 * is reporting the harness rather than the parser.
 */
const buildParser = async (caseName) => {
  const closed = isStrictCase(caseName)
  switch (libId) {
    case 'noop':
      return (input) => input
    case 'mjst': {
      const modulePath = closed ? strictModule : safeModule
      const mod = await import(modulePath)
      return mod.parseAssert
    }
    case 'zod': {
      const schema = parseZod(closed)
      return (input) => schema.parse(input)
    }
    case 'typebox': {
      const schema = parseTypebox(closed)
      const checker = TypeCompiler.Compile(schema)
      // Clone first so the operation stays pure, then strip (safe) or assert
      // against the closed schema (strict) — the pipeline `parsers.ts` runs.
      const assert = (value) => {
        if (!checker.Check(value)) throw new Error('invalid')
        return value
      }
      return closed ? (input) => assert(Value.Clone(input)) : (input) => assert(Value.Clean(schema, Value.Clone(input)))
    }
    default:
      throw new Error(`unknown library: ${libId}`)
  }
}

/**
 * Parity, so a number can only come from a parser that is really parsing: it
 * must accept the fixture, produce the declared fields, and — in the case that
 * has to — reject an undeclared key. The `noop` control is exempt by
 * construction; its row is labelled as the harness floor.
 */
const assertParity = (caseName, parse) => {
  if (libId === 'noop') return
  const parsed = parse(structuredClone(parseData))
  if (parsed.number !== 1 || parsed.deeplyNested.foo !== 'bar') {
    throw new Error(`${libId} did not parse the moltar fixture (${caseName})`)
  }
  if (isStrictCase(caseName)) {
    let threw = false
    try {
      parse(structuredClone(parseDataWithExtras))
    } catch {
      threw = true
    }
    if (!threw) throw new Error(`${libId} accepted an undeclared key in ${caseName}`)
  } else if ('extra' in parse(structuredClone(parseDataWithExtras))) {
    throw new Error(`${libId} kept an undeclared key in ${caseName}`)
  }
}

const results = {}
// benny's start-up banner would pollute the JSON line the orchestrator parses.
const log = console.log
for (const caseName of MOLTAR_PARSE_CASES) {
  const parse = await buildParser(caseName)
  assertParity(caseName, parse)
  for (const mode of MOLTAR_MODES) {
    const Case = mode === 'observed' ? ParseObserved : ParseDiscarded
    const benchmark = new Case(libId, parse)
    console.log = () => {}
    // benny's own defaults, unchanged — they are what the leaderboard runs
    // under. `cycle()` / `complete()` are left out.
    const summary = await benny.suite(
      `${caseName}:${mode}`,
      benny.add(libId, () => benchmark.run()),
    )
    console.log = log
    const [result] = summary.results
    results[`${caseName}:${mode}`] = {
      ops: result.ops,
      margin: result.margin,
      samples: result.details.sampleResults.length,
    }
  }
}

process.stdout.write(JSON.stringify(results))
