import { Value } from '@scalar/typebox/value'
import { coerce } from '@scalar/validation'
import { Bench } from 'tinybench'

import { parseDocument as parseLarge } from '../generate-parsers/benchmark/large/document'
import { parseDocument as parseMedium } from '../generate-parsers/benchmark/medium/document'
import { parseDocument as parseSmall } from '../generate-parsers/benchmark/small/document'
import { largeData } from './data/large'
import { largeInvalidData } from './data/large-invalid'
import { mediumData } from './data/medium'
import { mediumInvalidData } from './data/medium-invalid'
import { smallData } from './data/small'
import { smallInvalidData } from './data/small-invalid'
import { orderSchema } from './scalar-validation/large'
import { blogPostSchema } from './scalar-validation/medium'
import { userSchema } from './scalar-validation/small'
import { OrderSchema } from './typebox/large'
import { BlogPostSchema } from './typebox/medium'
import { UserSchema } from './typebox/small'

const sizes = [
  {
    name: 'small',
    validData: smallData,
    invalidData: smallInvalidData,
    typebox: UserSchema,
    validation: userSchema,
    parser: parseSmall,
  },
  {
    name: 'medium',
    validData: mediumData,
    invalidData: mediumInvalidData,
    typebox: BlogPostSchema,
    validation: blogPostSchema,
    parser: parseMedium,
  },
  {
    name: 'large',
    validData: largeData,
    invalidData: largeInvalidData,
    typebox: OrderSchema,
    validation: orderSchema,
    parser: parseLarge,
  },
] as const

for (const { name, validData, invalidData, typebox, validation, parser } of sizes) {
  for (const scenario of ['valid', 'invalid'] as const) {
    const data = scenario === 'valid' ? validData : invalidData
    const bench = new Bench({ name: `${name} schema` })

    bench
      .add('mjst generated parser', () => {
        parser(data)
      })
      .add('@scalar/typebox', () => {
        Value.Cast(typebox, data)
      })
      .add('@scalar/validation', () => {
        coerce(validation, data)
      })

    await bench.run()

    const tasks = bench.tasks
      .map((t) => ({ name: t.name, hz: t.result?.throughput?.mean ?? 0 }))
      .sort((a, b) => b.hz - a.hz)

    const fastest = tasks[0].hz
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

    console.log(`\n── ${name} (${scenario}) ──`)
    for (const { name: taskName, hz } of tasks) {
      const ratio = fastest / hz
      const rel = ratio < 1.05 ? 'fastest' : `${ratio.toFixed(1)}x slower`
      console.log(`  ${taskName.padEnd(26)} ${fmt(hz).padStart(14)} hz   ${rel}`)
    }
  }
}
