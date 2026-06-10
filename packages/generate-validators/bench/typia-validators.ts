import typia, { type tags } from 'typia'

import type { BoolValidator } from './validators.ts'

/**
 * typia validators for the benchmark cases, authored as TypeScript types so
 * typia's compile-time transformer can generate the checks (this file only runs
 * under the `typia-preload.ts` Bun plugin). The types mirror each case's JSON
 * Schema — including its `format`, length, range and pattern constraints — so
 * typia does the same work mjst's generated validator does and the parity
 * assertions hold on every sample.
 *
 * Strict cases (the schema sets `additionalProperties: false`) use
 * `createEquals`, which rejects undeclared keys at every level; the loose case
 * uses `createIs`. Both return a plain boolean, matching {@link BoolValidator}.
 */

type Small = {
  id: string & tags.Format<'uuid'>
  name: string & tags.MinLength<1> & tags.MaxLength<80>
  age: number & tags.Type<'int32'> & tags.Minimum<0> & tags.Maximum<130>
  active?: boolean
}

type Order = {
  id: string & tags.Format<'uuid'>
  status: 'pending' | 'paid' | 'shipped' | 'cancelled'
  total: number & tags.Minimum<0>
  customer: {
    name: string & tags.MinLength<1>
    email: string & tags.Format<'email'>
  }
  shipTo?: {
    street: string & tags.MinLength<1>
    city: string & tags.MinLength<1>
    zip: string & tags.Pattern<'^[0-9]{5}$'>
  }
  items: ({
    sku: string & tags.MinLength<1>
    qty: number & tags.Type<'int32'> & tags.Minimum<1>
    price: number & tags.Minimum<0>
  } & unknown)[] &
    tags.MinItems<1>
}

type AssertShape = {
  number: number
  negNumber: number
  maxNumber: number
  string: string
  longString: string
  boolean: boolean
  deeplyNested: { foo: string; num: number; bool: boolean }
}

/** Keyed by `BenchCase.name`; the worker picks the validator for its case. */
export const typiaValidators: Record<string, BoolValidator> = {
  'small (4 fields)': typia.createEquals<Small>(),
  'order (nested + array)': typia.createEquals<Order>(),
  'assert-loose': typia.createIs<AssertShape>(),
  'assert-strict': typia.createEquals<AssertShape>(),
}
