import { Value } from '@scalar/typebox/value'
import { coerce } from '@scalar/validation'
import { Bench } from 'tinybench'

import { parseDocument as parseLarge } from '../generate-parsers/benchmark/large/document'
import { parseDocument as parseMedium } from '../generate-parsers/benchmark/medium/document'
import { parseDocument as parseSmall } from '../generate-parsers/benchmark/small/document'
import { largeData } from './data/large'
import { mediumData } from './data/medium'
import { smallData } from './data/small'
import { orderSchema } from './scalar-validation/large'
import { blogPostSchema } from './scalar-validation/medium'
import { userSchema } from './scalar-validation/small'
import { OrderSchema } from './typebox/large'
import { BlogPostSchema } from './typebox/medium'
import { UserSchema } from './typebox/small'

const sizes = [
  {
    name: 'small',
    data: smallData,
    typebox: UserSchema,
    validation: userSchema,
    parser: parseSmall,
  },
  {
    name: 'medium',
    data: mediumData,
    typebox: BlogPostSchema,
    validation: blogPostSchema,
    parser: parseMedium,
  },
  {
    name: 'large',
    data: largeData,
    typebox: OrderSchema,
    validation: orderSchema,
    parser: parseLarge,
  },
] as const

for (const { name, data, typebox, validation, parser } of sizes) {
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

  console.log(`\n=== ${name} schema ===`)
  console.table(bench.table())
}
