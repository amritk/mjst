import { isObject } from 'mjst-helpers/is-object';

export type SpecificationExtensionsObject = Record<string, unknown>;

export const parseSpecificationExtensionsObject = (input: unknown): SpecificationExtensionsObject => {
  if (!isObject(input)) {
    return {};
  }
  const result: SpecificationExtensionsObject = {
    ...input,
  };
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      result[key] = value;
    }
  }
  return result;
};