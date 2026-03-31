import type { ReferenceObject } from './reference';
import { type ExampleObject, parseExampleObject } from './example';
import { validateRecord } from './validators/validate-record';
import { isObject } from './helpers/is-object';

export type ExamplesObject = {
  example?: boolean;
  examples?: Record<string, ExampleObject | ReferenceObject>;
};

export const parseExamplesObject = (input: unknown): ExamplesObject => {
  if (!isObject(input)) return {};
  const _examples = input.examples;
  return {
    ...input,
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
  };
}