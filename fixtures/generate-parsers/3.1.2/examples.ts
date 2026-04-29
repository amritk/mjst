import type { ReferenceObject } from './reference';
import { type ExampleObject, parseExampleObject } from './example';
import { validateRecord } from '@amritk/helpers/validate-record';
import { isObject } from '@amritk/helpers/is-object';

export type ExamplesObject = {
  example?: unknown;
  examples?: Record<string, ExampleObject | ReferenceObject>;
};

export const parseExamplesObject = (input: unknown): ExamplesObject => {
  if (!isObject(input)) return {} as ExamplesObject;
  const _examples = input.examples;
  return {
    ...input,
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
  } as unknown as ExamplesObject;
}