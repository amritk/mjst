import type { ReferenceObject } from './reference';
import { type ResponseObject, parseResponseObject } from './response';
import { isObject } from 'mjst-helpers/is-object';

export type ResponsesObject = {
  default?: ResponseObject | ReferenceObject;
} & Record<`x-${string}`, unknown>;

export const parseResponsesObject = (input: unknown): ResponsesObject => {
  if (!isObject(input)) {
    return {} as unknown as ResponsesObject;
  }
  const result = {
    ...input,
    ...(input.default && { default: isObject(input.default) && '$ref' in input.default ? input.default : parseResponseObject(input.default) }),
  } as unknown as ResponsesObject;
  for (const key in input) {
    if (/^[1-5](?:[0-9]{2}|XX)$/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = isObject(value) && '$ref' in value ? value : parseResponseObject(value);
    }
  }
  return result;
};